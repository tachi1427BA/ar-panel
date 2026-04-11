// Shared mutable state — import this object and mutate its properties.
// All modules share the same reference so mutations are immediately visible.
export const state = {
  currentCharacterSrc:   'シロコ.png',
  currentCharacterWidth: 0.85,
  currentCharacterLabel: 'シロコ',
  currentCharacterKey:   'シロコ.png',
  activeCharacter:       null,
  placedCharacters:      [],
  isFallbackMode:        false,
  isShootingMode:        false,
  isHitTestActive:       false,
  suppressNextPlacement: false,
  isExitingSession:      false,
  exitSessionTimeoutId:  null,
  characterCounter:      0,
  createdObjectUrls:     new Set(),
};
