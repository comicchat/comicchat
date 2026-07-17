// Core data types mirroring the original avatar.h structures.

/** Wheel emotions at 45° steps (angle = index*2π/8), from avatar.h. */
export const WHEEL_EMOTIONS = [
  'happy', 'coy', 'bored', 'scared', 'sad', 'angry', 'shout', 'laugh',
] as const;
export type WheelEmotion = (typeof WHEEL_EMOTIONS)[number];

export type GestureEmotion =
  | 'wave' | 'pointother' | 'pointself' | 'doublepoint' | 'shrug'
  | 'walk3qr' | 'walkside' | 'walk3qf';

export type EmotionName = WheelEmotion | GestureEmotion | 'neutral' | 'none';

/** CEmotion: an (angle, intensity) pair in the emotion wheel's polar space.
 *  Gestures use out-of-band values >1000 exactly like the original. */
export interface Emotion {
  emotion: number;   // wheel angle in radians, or 1001+ gesture codes
  intensity: number; // 0..1
}

export const EM = {
  HAPPY: 0 * Math.PI / 4,
  COY: 1 * Math.PI / 4,
  BORED: 2 * Math.PI / 4,
  SCARED: 3 * Math.PI / 4,
  SAD: 4 * Math.PI / 4,
  ANGRY: 5 * Math.PI / 4,
  SHOUT: 6 * Math.PI / 4,
  LAUGH: 7 * Math.PI / 4,
  NEUTRAL: 0,
  WAVE: 1001, POINTOTHER: 1002, POINTSELF: 1003, DOUBLEPOINT: 1004,
  SHRUG: 1005, WALK3QR: 1006, WALKSIDE: 1007, WALK3QF: 1008,
} as const;

/** emFloats[] from avatario.cpp: emotion index stored in .avb records. */
export const EMOTION_FLOATS: number[] = [
  0, EM.HAPPY, EM.COY, EM.BORED, EM.SCARED, EM.SAD, EM.ANGRY, EM.SHOUT,
  EM.LAUGH, EM.NEUTRAL, EM.WAVE, EM.POINTOTHER, EM.POINTSELF, EM.DOUBLEPOINT,
  EM.SHRUG, EM.WALK3QR, EM.WALKSIDE, EM.WALK3QF,
];

export interface PoseMeta {
  file: string;
  aura?: string;
  w: number;
  h: number;
}

/** FACEREC (complex avatars): head pose + attachment data. */
export interface FaceRec {
  pose: string;
  emotionIndex: number;
  intensity: number;
  cx: number; cy: number;           // head connection point
  cxDelta: number; cyDelta: number; // per-face connection adjustment
  x: number; y: number;             // face center (balloon tail target)
}

/** BODYREC (complex avatars): torso pose + head connection point. */
export interface TorsoRec {
  pose: string;
  emotionIndex: number;
  intensity: number;
  cx: number; cy: number;
}

/** RBODYREC (simple avatars): full-body pose. */
export interface BodyRec {
  pose: string;
  emotionIndex: number;
  intensity: number;
  x: number; y: number; // face center
}

export interface CharacterMeta {
  id: string;
  name: string;
  type: 'simple' | 'complex';
  style: number;
  flags: number;
  copyright?: string;
  icon: string | null;
  poses: Record<string, PoseMeta>;
  faces: FaceRec[];
  torsos: TorsoRec[];
  bodies: BodyRec[];
}

export interface ArtIndex {
  characters: { id: string; name: string; type: string; dir: string; icon: string | null }[];
  backgrounds: { id: string; name: string; file: string; w: number; h: number }[];
}

// avatar.h avatar flags
export const HEADMASK = 1;
export const TORSOMASK = 2;
export const TORSOFIRST = 4;
