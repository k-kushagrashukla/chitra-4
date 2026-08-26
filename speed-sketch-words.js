// Prompts for Speed Sketch, tiered by difficulty. Round 1 pulls from "easy",
// round 2 from "medium", round 3 from "hard" — difficulty AND less time both
// increase together, which is what makes round 3 actually feel hard.

const SPEED_SKETCH_WORDS = {
  easy: [
    { word: "Sun", hint: "Suraj", seconds: 20 },
    { word: "Cat", hint: "Billi", seconds: 20 },
    { word: "House", hint: "Ghar", seconds: 20 },
    { word: "Tree", hint: "Ped", seconds: 20 },
    { word: "Fish", hint: "Machli", seconds: 20 },
    { word: "Apple", hint: "Seb", seconds: 20 },
    { word: "Star", hint: "Sitara", seconds: 20 },
    { word: "Moon", hint: "Chaand", seconds: 20 },
    { word: "Flower", hint: "Phool", seconds: 20 },
    { word: "Ball", hint: "Gend", seconds: 20 },
    { word: "Cloud", hint: "Badal", seconds: 20 },
    { word: "Egg", hint: "Anda", seconds: 20 },
    { word: "Banana", hint: "Kela", seconds: 20 },
    { word: "Chair", hint: "Kursi", seconds: 20 },
    { word: "Dog", hint: "Kutta", seconds: 20 },
  ],
  medium: [
    { word: "Bicycle", hint: "Cycle", seconds: 15 },
    { word: "Umbrella", hint: "Chhata", seconds: 15 },
    { word: "Kite", hint: "Patang", seconds: 15 },
    { word: "Guitar", hint: "Guitar", seconds: 15 },
    { word: "Camera", hint: "Camera", seconds: 15 },
    { word: "Rickshaw", hint: "Auto", seconds: 15 },
    { word: "Elephant", hint: "Hathi", seconds: 15 },
    { word: "Butterfly", hint: "Titli", seconds: 15 },
    { word: "Boat", hint: "Naav", seconds: 15 },
    { word: "Watch", hint: "Ghadi", seconds: 15 },
    { word: "Ice cream", hint: "Ice cream", seconds: 15 },
    { word: "Glasses", hint: "Chashma", seconds: 15 },
    { word: "Crown", hint: "Taj", seconds: 15 },
    { word: "Backpack", hint: "Bastaa", seconds: 15 },
  ],
  hard: [
    { word: "Elephant washing", hint: "Hathi nahaa raha hai", seconds: 12 },
    { word: "Helicopter", hint: "Helicopter", seconds: 12 },
    { word: "Peacock dancing", hint: "Mor naach raha hai", seconds: 12 },
    { word: "Octopus", hint: "Octopus", seconds: 12 },
    { word: "Cricket match", hint: "Cricket match", seconds: 12 },
    { word: "Rocket launch", hint: "Rocket launch", seconds: 12 },
    { word: "Chef cooking", hint: "Cook khaana bana raha hai", seconds: 12 },
    { word: "Traffic jam", hint: "Traffic jam", seconds: 12 },
    { word: "Wedding stage", hint: "Shaadi ka stage", seconds: 12 },
    { word: "Mountain climber", hint: "Pahaad chadhne wala", seconds: 12 },
    { word: "Robot dancing", hint: "Robot naach raha hai", seconds: 12 },
  ],
};

function getSpeedSketchRound(difficulty) {
  const pool = SPEED_SKETCH_WORDS[difficulty] || SPEED_SKETCH_WORDS.easy;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { SPEED_SKETCH_WORDS, getSpeedSketchRound };
