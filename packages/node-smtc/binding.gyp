{
  "targets": [
    {
      "target_name": "smtc_player",
      "sources": [ "src/smtc_addon.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "C:/Program Files (x86)/Windows Kits/10/Include/10.0.26100.0/cppwinrt"
      ],
      "defines": [
        "NODE_ADDON_API_CPP_EXCEPTIONS",
        "_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS"
      ],
      "libraries": [ "windowsapp.lib" ],
      "configurations": {
        "Release": {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [ "/EHsc" ]
            }
          }
        },
        "Debug": {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [ "/EHsc" ]
            }
          }
        }
      }
    }
  ]
}
