// smtc_addon.cc -- Node.js native addon for Windows System Media Transport Controls.
// Uses MediaPlayer (silent WAV loop) so Windows registers the SMTC session properly.
// SMTC session = process lifetime. Object never returned to JS.

#pragma comment(lib, "windowsapp")

#include <napi.h>
#include <windows.h>

// C++/WinRT
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.h>
#include <winrt/Windows.Media.Core.h>
#include <winrt/Windows.Media.Playback.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>

#include <thread>
#include <atomic>
#include <mutex>
#include <string>
#include <memory>
#include <fstream>
#include <vector>

namespace wf  = winrt::Windows::Foundation;
namespace wm  = winrt::Windows::Media;
namespace wc  = winrt::Windows::Media::Core;
namespace wp  = winrt::Windows::Media::Playback;
namespace ws  = winrt::Windows::Storage;
namespace wss = winrt::Windows::Storage::Streams;

// ============================================================================
// Global state
// ============================================================================
static std::thread                  g_thread;
static std::atomic<bool>            g_running{false};
static HWND                         g_hwnd = nullptr;
static wp::MediaPlayer              g_player{nullptr};
static wm::SystemMediaTransportControls g_controls{nullptr};
static winrt::event_token           g_buttonToken;
static winrt::event_token           g_shuffleToken;
static winrt::event_token           g_repeatToken;
static winrt::event_token           g_positionToken;
static std::mutex                   g_controlsMutex;
static Napi::ThreadSafeFunction     g_eventTsfn;
static std::wstring                 g_wavPath;     // temp WAV for cleanup
static std::wstring                 g_appMediaId;  // caller-defined app identity

// ============================================================================
// STA dispatch — setters called from JS thread, SMTC lives on STA thread.
// PostMessage to hidden window → WndProc runs operation on correct thread.
// ============================================================================
constexpr UINT WM_SMTC_OP = WM_APP + 1;

enum class SmtcOp : WPARAM {
    SetArtist       = 1,
    SetAlbumArtist  = 2,
    SetTitle        = 3,
    SetAlbumTitle   = 4,
    SetThumbnail    = 5,
    SetShuffle      = 6,
    SetAutoRepeat   = 7,
    SetStartTime    = 8,
    SetMinSeekTime  = 9,
    SetPosition     = 10,
    SetMaxSeekTime   = 11,
    SetEndTime       = 12,
    SetPlaybackStatus = 13,
    SetAppMediaId    = 14,
};

struct SmtcOpData {
    SmtcOp op;
    union {
        wchar_t* str;      // OP_SetArtist .. OP_SetThumbnail
        bool    shuffle;   // OP_SetShuffle
        int     repeat;    // OP_SetAutoRepeat (0=none,1=track,2=list)
        int64_t timelineMs; // OP_SetStartTime .. OP_SetEndTime (milliseconds)
        int     status;     // OP_SetPlaybackStatus (0=Playing,1=Paused,2=Stopped,3=Changing,4=Closed)
    };
    ~SmtcOpData() {
        if ((static_cast<int>(op) >= 1 && static_cast<int>(op) <= 5) || op == SmtcOp::SetAppMediaId) delete[] str;
    }
};

// ============================================================================
// Metadata cache — SMTC Update() pushes ALL fields, so we must re-apply
// every cached value each time any field changes. Otherwise setting only
// Artist would blank the Title, etc.
// ============================================================================
struct MediaMeta {
    std::wstring artist;
    std::wstring albumArtist;
    std::wstring title;
    std::wstring albumTitle;
    std::wstring thumbnailPath;  // empty = none
};
static MediaMeta  g_meta;
static std::mutex g_metaMutex;

// ============================================================================
// Timeline cache — same pattern: UpdateTimelineProperties() overwrites all
// fields, so we cache and re-apply.
// All values in milliseconds. Converted to TimeSpan (100ns ticks) on apply.
// ============================================================================
struct TimelineMeta {
    int64_t startTime   = 0;  // ms
    int64_t minSeekTime = 0;  // ms
    int64_t position    = 0;  // ms
    int64_t maxSeekTime = 0;  // ms
    int64_t endTime     = 0;  // ms
};
static TimelineMeta g_timeline;
static std::mutex   g_timelineMutex;

static int64_t MsToTicks(int64_t ms) { return ms * 10000; }

static void ApplyAllTimeline() {
    if (!g_controls) return;
    std::lock_guard<std::mutex> lock(g_timelineMutex);
    wm::SystemMediaTransportControlsTimelineProperties tl;
    tl.StartTime(wf::TimeSpan{MsToTicks(g_timeline.startTime)});
    tl.MinSeekTime(wf::TimeSpan{MsToTicks(g_timeline.minSeekTime)});
    tl.Position(wf::TimeSpan{MsToTicks(g_timeline.position)});
    tl.MaxSeekTime(wf::TimeSpan{MsToTicks(g_timeline.maxSeekTime)});
    tl.EndTime(wf::TimeSpan{MsToTicks(g_timeline.endTime)});
    g_controls.UpdateTimelineProperties(tl);
}

// Forward decls needed by WndProc
static wm::SystemMediaTransportControlsDisplayUpdater GetUpdater();
static std::wstring Utf8ToWide(const std::string&);

// Apply ALL cached metadata to SMTC. Call after any field changes.
static void ApplyAllMeta() {
    auto u = GetUpdater();
    if (!u) return;
    auto m = u.MusicProperties();
    std::lock_guard<std::mutex> lock(g_metaMutex);
    m.Artist(winrt::hstring(g_meta.artist));
    m.AlbumArtist(winrt::hstring(g_meta.albumArtist));
    m.Title(winrt::hstring(g_meta.title));
    m.AlbumTitle(winrt::hstring(g_meta.albumTitle));
    if (!g_meta.thumbnailPath.empty()) {
        try {
            auto file   = ws::StorageFile::GetFileFromPathAsync(g_meta.thumbnailPath).get();
            auto stream = file.OpenReadAsync().get();
            auto thumb  = wss::RandomAccessStreamReference::CreateFromStream(stream);
            u.Thumbnail(thumb);
        } catch (...) {}
    }
    u.Update();
}

static LRESULT CALLBACK SmtcWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_SMTC_OP && lParam) {
        std::unique_ptr<SmtcOpData> data(reinterpret_cast<SmtcOpData*>(lParam));
        try {
            switch (data->op) {
                case SmtcOp::SetArtist:
                    { std::lock_guard<std::mutex> lk(g_metaMutex); g_meta.artist = data->str; }
                    ApplyAllMeta();
                    break;
                case SmtcOp::SetAlbumArtist:
                    { std::lock_guard<std::mutex> lk(g_metaMutex); g_meta.albumArtist = data->str; }
                    ApplyAllMeta();
                    break;
                case SmtcOp::SetTitle:
                    { std::lock_guard<std::mutex> lk(g_metaMutex); g_meta.title = data->str; }
                    ApplyAllMeta();
                    break;
                case SmtcOp::SetAlbumTitle:
                    { std::lock_guard<std::mutex> lk(g_metaMutex); g_meta.albumTitle = data->str; }
                    ApplyAllMeta();
                    break;
                case SmtcOp::SetThumbnail:
                    { std::lock_guard<std::mutex> lk(g_metaMutex); g_meta.thumbnailPath = data->str; }
                    ApplyAllMeta();
                    break;
                case SmtcOp::SetShuffle:
                    if (g_controls) g_controls.ShuffleEnabled(data->shuffle);
                    break;
                case SmtcOp::SetAutoRepeat: {
                    auto m = wm::MediaPlaybackAutoRepeatMode::None;
                    if (data->repeat == 1)      m = wm::MediaPlaybackAutoRepeatMode::Track;
                    else if (data->repeat == 2) m = wm::MediaPlaybackAutoRepeatMode::List;
                    if (g_controls) g_controls.AutoRepeatMode(m);
                    break;
                }
                case SmtcOp::SetStartTime:
                    { std::lock_guard<std::mutex> lk(g_timelineMutex); g_timeline.startTime = data->timelineMs; }
                    ApplyAllTimeline();
                    break;
                case SmtcOp::SetMinSeekTime:
                    { std::lock_guard<std::mutex> lk(g_timelineMutex); g_timeline.minSeekTime = data->timelineMs; }
                    ApplyAllTimeline();
                    break;
                case SmtcOp::SetPosition:
                    { std::lock_guard<std::mutex> lk(g_timelineMutex); g_timeline.position = data->timelineMs; }
                    ApplyAllTimeline();
                    break;
                case SmtcOp::SetMaxSeekTime:
                    { std::lock_guard<std::mutex> lk(g_timelineMutex); g_timeline.maxSeekTime = data->timelineMs; }
                    ApplyAllTimeline();
                    break;
                case SmtcOp::SetEndTime:
                    { std::lock_guard<std::mutex> lk(g_timelineMutex); g_timeline.endTime = data->timelineMs; }
                    ApplyAllTimeline();
                    break;
                case SmtcOp::SetPlaybackStatus: {
                    auto s = wm::MediaPlaybackStatus::Playing;
                    switch (data->status) {
                    case 1: s = wm::MediaPlaybackStatus::Paused;   break;
                    case 2: s = wm::MediaPlaybackStatus::Stopped;  break;
                    case 3: s = wm::MediaPlaybackStatus::Changing; break;
                    case 4: s = wm::MediaPlaybackStatus::Closed;   break;
                    default: break; // 0 = Playing
                    }
                    if (g_controls) g_controls.PlaybackStatus(s);
                    break;
                }
                case SmtcOp::SetAppMediaId: {
                    g_appMediaId = data->str;
                    auto u = GetUpdater();
                    if (u) {
                        u.AppMediaId(winrt::hstring(g_appMediaId));
                        u.Update();
                    }
                    break;
                }
            }
        } catch (...) {}
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

// Pending-op queue for calls that arrive before the STA window exists
static std::mutex                  g_pendingMutex;
static std::vector<std::unique_ptr<SmtcOpData>> g_pendingOps;

static void FlushPendingOps() {
    std::lock_guard<std::mutex> lock(g_pendingMutex);
    for (auto& ptr : g_pendingOps) {
        SendMessageW(g_hwnd, WM_SMTC_OP, (WPARAM)ptr->op, (LPARAM)ptr.get());
        ptr.release();  // WndProc took ownership via unique_ptr
    }
    g_pendingOps.clear();
}

static void PostSmtcOp(SmtcOpData* data) {
    std::unique_ptr<SmtcOpData> ptr(data);
    if (g_hwnd) {
        SendMessageW(g_hwnd, WM_SMTC_OP, (WPARAM)ptr->op, (LPARAM)ptr.get());
        // SendMessage processed synchronously on STA thread — data already consumed
        ptr.release(); // prevent double-free from unique_ptr destructor
    } else {
        std::lock_guard<std::mutex> lock(g_pendingMutex);
        g_pendingOps.push_back(std::move(ptr));
    }
}

// ============================================================================
// UTF-8 -> wide string
// ============================================================================
static std::wstring Utf8ToWide(const std::string& utf8) {
    if (utf8.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), (int)utf8.size(), nullptr, 0);
    std::wstring result(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), (int)utf8.size(), &result[0], len);
    return result;
}

// ============================================================================
// Forward
// ============================================================================
static void Cleanup(void*);

// ============================================================================
// Create silent WAV file -> temp path
//   44100 Hz, 16-bit mono, 10 seconds of silence.
//   Looped by MediaPlayer to keep audio session alive indefinitely.
// ============================================================================
static std::wstring CreateSilentWav() {
    wchar_t tempPath[MAX_PATH];
    GetTempPathW(MAX_PATH, tempPath);
    wchar_t tempFile[MAX_PATH];
    GetTempFileNameW(tempPath, L"smc", 0, tempFile);
    // Replace .tmp with .wav
    std::wstring wavPath(tempFile);
    wavPath = wavPath.substr(0, wavPath.size() - 4) + L".wav";

    int sampleRate    = 44100;
    short channels    = 1;
    short bitsPer     = 16;
    int durationSec   = 10;
    int dataSize      = sampleRate * durationSec * channels * (bitsPer / 8);
    int byteRate      = sampleRate * channels * (bitsPer / 8);
    short blockAlign  = (short)(channels * (bitsPer / 8));
    int fileSize      = 36 + dataSize;  // header (44) - 8 (RIFF/size) = 36

    std::ofstream f(wavPath, std::ios::binary);
    if (!f) return L"";

    auto w32 = [&](uint32_t v)  { f.write((char*)&v, 4); };
    auto w16 = [&](uint16_t v)  { f.write((char*)&v, 2); };
    auto w8  = [&](const char* s, int n) { f.write(s, n); };

    w8("RIFF", 4);           //  0: chunk ID
    w32(fileSize);           //  4: file size - 8
    w8("WAVE", 4);           //  8: format
    w8("fmt ", 4);           // 12: subchunk1 ID
    w32(16);                  // 16: subchunk1 size (PCM)
    w16(1);                   // 20: audio format (PCM = 1)
    w16(channels);           // 22: channels
    w32(sampleRate);         // 24: sample rate
    w32(byteRate);           // 28: byte rate
    w16(blockAlign);         // 32: block align
    w16(bitsPer);            // 34: bits per sample
    w8("data", 4);           // 36: subchunk2 ID
    w32(dataSize);           // 40: subchunk2 size

    std::vector<char> silence(dataSize, 0);
    f.write(silence.data(), dataSize);
    f.close();

    return wavPath;
}

// ============================================================================
// Message pump thread -- owns hidden window, MediaPlayer, SMTC
// ============================================================================
static void MessageThreadProc() {
    winrt::init_apartment(winrt::apartment_type::single_threaded);

    // --- Register window class (for message pump) ---
    WNDCLASSEXW wc = {};
    wc.cbSize        = sizeof(wc);
    wc.lpfnWndProc   = SmtcWndProc;
    wc.hInstance     = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"SMTC_HiddenWindow";
    ATOM atom = RegisterClassExW(&wc);
    if (!atom) { winrt::uninit_apartment(); return; }

    g_hwnd = CreateWindowExW(
        0, (LPCWSTR)(UINT_PTR)(WORD)atom, L"", 0,
        0, 0, 0, 0, HWND_MESSAGE, nullptr, nullptr, nullptr);
    if (!g_hwnd) { winrt::uninit_apartment(); return; }

    // --- MediaPlayer + SMTC setup ---
    try {
        // 1. Create MediaPlayer, disable automatic command management
        wp::MediaPlayer player;
        player.CommandManager().IsEnabled(false);

        // 2. Get SMTC from player (no interop needed)
        auto ctrl = player.SystemMediaTransportControls();

        // 3. Configure SMTC buttons
        ctrl.IsEnabled(true);
        ctrl.IsPlayEnabled(true);
        ctrl.IsPauseEnabled(true);
        ctrl.IsNextEnabled(true);
        ctrl.IsPreviousEnabled(true);
        ctrl.IsStopEnabled(false);
        ctrl.IsFastForwardEnabled(false);
        ctrl.IsRewindEnabled(false);
        ctrl.IsChannelUpEnabled(false);
        ctrl.IsChannelDownEnabled(false);
        ctrl.IsRecordEnabled(false);
        ctrl.ShuffleEnabled(false);
        ctrl.AutoRepeatMode(wm::MediaPlaybackAutoRepeatMode::None);
        ctrl.PlaybackStatus(wm::MediaPlaybackStatus::Playing);

        // 4. Set metadata
        auto updater = ctrl.DisplayUpdater();
        updater.AppMediaId(winrt::hstring(g_appMediaId));
        updater.Type(wm::MediaPlaybackType::Music);
        updater.Update();

        // 5. Button press -> JS
        g_buttonToken = ctrl.ButtonPressed([](auto&&, auto&& args) {
            std::string eventName;
            switch (args.Button()) {
                case wm::SystemMediaTransportControlsButton::Play:     eventName = "play";     break;
                case wm::SystemMediaTransportControlsButton::Pause:    eventName = "pause";    break;
                case wm::SystemMediaTransportControlsButton::Next:     eventName = "next";     break;
                case wm::SystemMediaTransportControlsButton::Previous: eventName = "previous"; break;
                default: return;
            }
            if (g_eventTsfn) {
                auto name = std::make_shared<std::string>(std::move(eventName));
                g_eventTsfn.NonBlockingCall([name](Napi::Env env, Napi::Function cb) {
                    cb.Call({Napi::String::New(env, *name), env.Undefined()});
                });
            }
        });

        // 6. Shuffle / repeat change -> JS
        g_shuffleToken = ctrl.ShuffleEnabledChangeRequested([](auto&&, auto&& args) {
            if (!g_eventTsfn) return;
            auto val = std::make_shared<bool>(args.RequestedShuffleEnabled());
            g_eventTsfn.NonBlockingCall([val](Napi::Env env, Napi::Function cb) {
                cb.Call({Napi::String::New(env, "shuffle"), Napi::Boolean::New(env, *val)});
            });
        });

        g_repeatToken = ctrl.AutoRepeatModeChangeRequested([](auto&&, auto&& args) {
            if (!g_eventTsfn) return;
            auto mode = std::make_shared<wm::MediaPlaybackAutoRepeatMode>(
                args.RequestedAutoRepeatMode());
            g_eventTsfn.NonBlockingCall([mode](Napi::Env env, Napi::Function cb) {
                const wchar_t* s = L"none";
                if (*mode == wm::MediaPlaybackAutoRepeatMode::Track) s = L"track";
                else if (*mode == wm::MediaPlaybackAutoRepeatMode::List) s = L"list";
                cb.Call({Napi::String::New(env, "repeat"), Napi::String::New(env, winrt::to_string(s))});
            });
        });

        // PositionChangeRequested -> JS (user seeks via SMTC UI)
        g_positionToken = ctrl.PlaybackPositionChangeRequested([](auto&&, auto&& args) {
            if (!g_eventTsfn) return;
            auto posMs = std::make_shared<int64_t>(
                args.RequestedPlaybackPosition().count() / 10000);  // ticks -> ms
            g_eventTsfn.NonBlockingCall([posMs](Napi::Env env, Napi::Function cb) {
                cb.Call({Napi::String::New(env, "positionchange"),
                         Napi::Number::New(env, (double)*posMs)});
            });
        });

        // 7. Create silent WAV, set as source, loop forever
        g_wavPath = CreateSilentWav();
        if (!g_wavPath.empty()) {
            auto file   = ws::StorageFile::GetFileFromPathAsync(g_wavPath).get();
            auto source = wc::MediaSource::CreateFromStorageFile(file);
            player.Source(source);
            player.IsLoopingEnabled(true);
            player.Play();
        }

        {
            std::lock_guard<std::mutex> lock(g_controlsMutex);
            g_player   = player;
            g_controls = ctrl;
        }

        // Now safe to process any ops queued before SMTC was ready
        FlushPendingOps();

    } catch (winrt::hresult_error const&) {
        // SMTC / MediaPlayer unavailable -- window runs, setters become no-ops
    }

    // --- Message pump ---
    MSG msg;
    while (g_running && GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    // --- Teardown ---
    {
        std::lock_guard<std::mutex> lock(g_controlsMutex);
        if (g_controls) {
            g_controls.ButtonPressed(g_buttonToken);
            g_controls.ShuffleEnabledChangeRequested(g_shuffleToken);
            g_controls.AutoRepeatModeChangeRequested(g_repeatToken);
            g_controls.PlaybackPositionChangeRequested(g_positionToken);
            g_controls = nullptr;
        }
        if (g_player) {
            g_player.Source(nullptr);
            g_player.Close();
            g_player = nullptr;
        }
    }
    // Delete temp WAV
    if (!g_wavPath.empty()) {
        DeleteFileW(g_wavPath.c_str());
        g_wavPath.clear();
    }
    if (g_hwnd) { DestroyWindow(g_hwnd); g_hwnd = nullptr; }
    winrt::uninit_apartment();
}

// ============================================================================
// Stop — tear down SMTC session and background thread.
// Safe to call multiple times; no-op if not running.
// After stop(), start() can be called again.
// ============================================================================
static void DoStop() {
    if (!g_running) return;
    g_running = false;
    if (g_hwnd) PostMessageW(g_hwnd, WM_QUIT, 0, 0);
    if (g_thread.joinable()) g_thread.join();
    g_thread = std::thread();  // reset to not-joinable state

    // Flush any pending ops that never got delivered
    {
        std::lock_guard<std::mutex> lock(g_pendingMutex);
        g_pendingOps.clear();
    }

    if (g_eventTsfn) {
        g_eventTsfn.Release();
        g_eventTsfn = nullptr;
    }

    g_hwnd = nullptr;
    g_appMediaId.clear();
}

// ============================================================================
// N-API: stop()
// ============================================================================
static Napi::Value Stop(const Napi::CallbackInfo& info) {
    DoStop();
    return info.Env().Undefined();
}

// ============================================================================
// Cleanup hook -- Node.js calls before addon unload
// ============================================================================
static void Cleanup(void*) {
    DoStop();
}

// ============================================================================
// Thread-safe updater access
// ============================================================================
static wm::SystemMediaTransportControlsDisplayUpdater GetUpdater() {
    std::lock_guard<std::mutex> lock(g_controlsMutex);
    if (g_controls) return g_controls.DisplayUpdater();
    return nullptr;
}

// ============================================================================
// N-API: start() -- idempotent, creates background thread + MediaPlayer + SMTC
// ============================================================================
static Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (g_running) return env.Undefined();
    g_running = true;
    g_thread = std::thread(MessageThreadProc);
    return env.Undefined();
}

// ============================================================================
// N-API: setEventCallback(callback)
//   callback(eventName: string, value?: any) invoked on SMTC events.
//   Call once. Subsequent calls replace previous.
// ============================================================================
static Napi::Value SetEventCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected a function").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (g_eventTsfn) g_eventTsfn.Release();
    g_eventTsfn = Napi::ThreadSafeFunction::New(
        env, info[0].As<Napi::Function>(),
        "SMTC_EventBridge", 0, 1);
    return env.Undefined();
}

// ============================================================================
// Metadata setters — marshal args, post operation to STA thread via hidden window.
// Actual SMTC/updater calls happen inside SmtcWndProc on the correct thread.
// ============================================================================
static Napi::Value SetArtist(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return info.Env().Undefined();
    auto data = new SmtcOpData{SmtcOp::SetArtist};
    auto w = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
    data->str = new wchar_t[w.size() + 1];
    wcscpy_s(data->str, w.size() + 1, w.c_str());
    PostSmtcOp(data);
    return info.Env().Undefined();
}

static Napi::Value SetAlbumArtist(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return info.Env().Undefined();
    auto data = new SmtcOpData{SmtcOp::SetAlbumArtist};
    auto w = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
    data->str = new wchar_t[w.size() + 1];
    wcscpy_s(data->str, w.size() + 1, w.c_str());
    PostSmtcOp(data);
    return info.Env().Undefined();
}

static Napi::Value SetTitle(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return info.Env().Undefined();
    auto data = new SmtcOpData{SmtcOp::SetTitle};
    auto w = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
    data->str = new wchar_t[w.size() + 1];
    wcscpy_s(data->str, w.size() + 1, w.c_str());
    PostSmtcOp(data);
    return info.Env().Undefined();
}

static Napi::Value SetAlbumTitle(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return info.Env().Undefined();
    auto data = new SmtcOpData{SmtcOp::SetAlbumTitle};
    auto w = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
    data->str = new wchar_t[w.size() + 1];
    wcscpy_s(data->str, w.size() + 1, w.c_str());
    PostSmtcOp(data);
    return info.Env().Undefined();
}

static Napi::Value SetThumbnail(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return info.Env().Undefined();
    auto data = new SmtcOpData{SmtcOp::SetThumbnail};
    auto w = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
    data->str = new wchar_t[w.size() + 1];
    wcscpy_s(data->str, w.size() + 1, w.c_str());
    PostSmtcOp(data);
    return info.Env().Undefined();
}

// ============================================================================
// N-API: setAppMediaId(id)
// ============================================================================
static Napi::Value SetAppMediaId(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return info.Env().Undefined();
    auto data = new SmtcOpData{SmtcOp::SetAppMediaId};
    auto w = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
    data->str = new wchar_t[w.size() + 1];
    wcscpy_s(data->str, w.size() + 1, w.c_str());
    PostSmtcOp(data);
    return info.Env().Undefined();
}

// ============================================================================
// N-API: setShuffle(enabled)
// ============================================================================
static Napi::Value SetShuffle(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsBoolean()) return info.Env().Undefined();
    auto data = new SmtcOpData{SmtcOp::SetShuffle};
    data->shuffle = info[0].As<Napi::Boolean>().Value();
    PostSmtcOp(data);
    return info.Env().Undefined();
}

// ============================================================================
// N-API: setPlaybackStatus(status)
//   status: "playing" | "paused" | "stopped" | "changing" | "closed"
// ============================================================================
static Napi::Value SetPlaybackStatus(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return info.Env().Undefined();
    auto s = info[0].As<Napi::String>().Utf8Value();
    int status = 0;
    if (s == "paused")        status = 1;
    else if (s == "stopped")  status = 2;
    else if (s == "changing") status = 3;
    else if (s == "closed")   status = 4;
    auto data = new SmtcOpData{SmtcOp::SetPlaybackStatus};
    data->status = status;
    PostSmtcOp(data);
    return info.Env().Undefined();
}

// ============================================================================
// N-API: setAutoRepeat(mode)
//   mode: "none" | "track" | "list"
// ============================================================================
static Napi::Value SetAutoRepeat(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return info.Env().Undefined();
    auto s = info[0].As<Napi::String>().Utf8Value();
    int mode = 0;
    if (s == "track")      mode = 1;
    else if (s == "list")  mode = 2;
    auto data = new SmtcOpData{SmtcOp::SetAutoRepeat};
    data->repeat = mode;
    PostSmtcOp(data);
    return info.Env().Undefined();
}

// ============================================================================
// Timeline setters — values in milliseconds
// ============================================================================
static Napi::Value SetStartTime(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsNumber()) return info.Env().Undefined();
    auto d = new SmtcOpData{SmtcOp::SetStartTime};
    d->timelineMs = info[0].As<Napi::Number>().Int64Value();
    PostSmtcOp(d);
    return info.Env().Undefined();
}
static Napi::Value SetMinSeekTime(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsNumber()) return info.Env().Undefined();
    auto d = new SmtcOpData{SmtcOp::SetMinSeekTime};
    d->timelineMs = info[0].As<Napi::Number>().Int64Value();
    PostSmtcOp(d);
    return info.Env().Undefined();
}
static Napi::Value SetPosition(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsNumber()) return info.Env().Undefined();
    auto d = new SmtcOpData{SmtcOp::SetPosition};
    d->timelineMs = info[0].As<Napi::Number>().Int64Value();
    PostSmtcOp(d);
    return info.Env().Undefined();
}
static Napi::Value SetMaxSeekTime(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsNumber()) return info.Env().Undefined();
    auto d = new SmtcOpData{SmtcOp::SetMaxSeekTime};
    d->timelineMs = info[0].As<Napi::Number>().Int64Value();
    PostSmtcOp(d);
    return info.Env().Undefined();
}
static Napi::Value SetEndTime(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsNumber()) return info.Env().Undefined();
    auto d = new SmtcOpData{SmtcOp::SetEndTime};
    d->timelineMs = info[0].As<Napi::Number>().Int64Value();
    PostSmtcOp(d);
    return info.Env().Undefined();
}

// ============================================================================
// Module init
// ============================================================================
static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("start",            Napi::Function::New(env, Start));
    exports.Set("setEventCallback", Napi::Function::New(env, SetEventCallback));
    exports.Set("setArtist",        Napi::Function::New(env, SetArtist));
    exports.Set("setAlbumArtist",   Napi::Function::New(env, SetAlbumArtist));
    exports.Set("setTitle",         Napi::Function::New(env, SetTitle));
    exports.Set("setAlbumTitle",    Napi::Function::New(env, SetAlbumTitle));
    exports.Set("setThumbnail",     Napi::Function::New(env, SetThumbnail));
    exports.Set("setAppMediaId",    Napi::Function::New(env, SetAppMediaId));
    exports.Set("setShuffle",       Napi::Function::New(env, SetShuffle));
    exports.Set("setAutoRepeat",    Napi::Function::New(env, SetAutoRepeat));
    exports.Set("setStartTime",     Napi::Function::New(env, SetStartTime));
    exports.Set("setMinSeekTime",   Napi::Function::New(env, SetMinSeekTime));
    exports.Set("setPosition",      Napi::Function::New(env, SetPosition));
    exports.Set("setMaxSeekTime",   Napi::Function::New(env, SetMaxSeekTime));
    exports.Set("setEndTime",         Napi::Function::New(env, SetEndTime));
    exports.Set("setPlaybackStatus",   Napi::Function::New(env, SetPlaybackStatus));
    exports.Set("stop",               Napi::Function::New(env, Stop));

    napi_add_env_cleanup_hook(env, Cleanup, nullptr);
    return exports;
}

NODE_API_MODULE(smtc_player, Init)
