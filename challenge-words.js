// Prompts for the "Let's See Your Drawing Mister" challenge link.
// These are deliberately tough AND deliberately unambiguous (single, clear
// noun or clear short action) — per the original spec, there should be zero
// confusion about what was asked for, only about whether you can pull it off
// in time.

const CHALLENGE_WORDS = [
  { word: "Helicopter", hint: "Helicopter", seconds: 15 },
  { word: "Octopus", hint: "Octopus", seconds: 15 },
  { word: "Peacock", hint: "Mor", seconds: 15 },
  { word: "Bicycle", hint: "Cycle", seconds: 15 },
  { word: "Elephant", hint: "Hathi", seconds: 15 },
  { word: "Guitar", hint: "Guitar", seconds: 15 },
  { word: "Camera", hint: "Camera", seconds: 15 },
  { word: "Crown", hint: "Taj", seconds: 15 },
  { word: "Rocket", hint: "Rocket", seconds: 15 },
  { word: "Butterfly", hint: "Titli", seconds: 15 },
  { word: "Umbrella", hint: "Chhata", seconds: 15 },
  { word: "Auto rickshaw", hint: "Auto", seconds: 15 },
];

function getChallengeWord() {
  return CHALLENGE_WORDS[Math.floor(Math.random() * CHALLENGE_WORDS.length)];
}

module.exports = { CHALLENGE_WORDS, getChallengeWord };
