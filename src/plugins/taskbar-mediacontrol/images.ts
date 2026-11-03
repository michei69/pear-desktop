import dislikeHollowIconBlack from '@assets/media-icons-black/dislike-hollow.png?asset&asarUnpack';
import dislikeIconBlack from '@assets/media-icons-black/dislike.png?asset&asarUnpack';
import likeHollowIconBlack from '@assets/media-icons-black/like-hollow.png?asset&asarUnpack';
import likeIconBlack from '@assets/media-icons-black/like.png?asset&asarUnpack';
import nextIconBlack from '@assets/media-icons-black/next.png?asset&asarUnpack';
import pauseIconBlack from '@assets/media-icons-black/pause.png?asset&asarUnpack';
import playIconBlack from '@assets/media-icons-black/play.png?asset&asarUnpack';
import previousIconBlack from '@assets/media-icons-black/previous.png?asset&asarUnpack';
import dislikeHollowIconWhite from '@assets/media-icons-white/dislike-hollow.png?asset&asarUnpack';
import dislikeIconWhite from '@assets/media-icons-white/dislike.png?asset&asarUnpack';
import likeHollowIconWhite from '@assets/media-icons-white/like-hollow.png?asset&asarUnpack';
import likeIconWhite from '@assets/media-icons-white/like.png?asset&asarUnpack';
import nextIconWhite from '@assets/media-icons-white/next.png?asset&asarUnpack';
import pauseIconWhite from '@assets/media-icons-white/pause.png?asset&asarUnpack';
import playIconWhite from '@assets/media-icons-white/play.png?asset&asarUnpack';
import previousIconWhite from '@assets/media-icons-white/previous.png?asset&asarUnpack';
import { nativeImage, nativeTheme, type NativeImage } from 'electron';

export type ThumbarImages = Record<
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'like'
  | 'dislike'
  | 'likeHollow'
  | 'dislikeHollow',
  NativeImage
>;

export const getImages = (): ThumbarImages => {
  const isDark = nativeTheme.shouldUseDarkColors;
  return {
    play: nativeImage.createFromPath(isDark ? playIconWhite : playIconBlack),
    pause: nativeImage.createFromPath(isDark ? pauseIconWhite : pauseIconBlack),
    next: nativeImage.createFromPath(isDark ? nextIconWhite : nextIconBlack),
    previous: nativeImage.createFromPath(
      isDark ? previousIconWhite : previousIconBlack,
    ),
    like: nativeImage.createFromPath(isDark ? likeIconWhite : likeIconBlack),
    dislike: nativeImage.createFromPath(
      isDark ? dislikeIconWhite : dislikeIconBlack,
    ),
    likeHollow: nativeImage.createFromPath(
      isDark ? likeHollowIconWhite : likeHollowIconBlack,
    ),
    dislikeHollow: nativeImage.createFromPath(
      isDark ? dislikeHollowIconWhite : dislikeHollowIconBlack,
    ),
  };
};
