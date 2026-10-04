// Editable adoption roster. Add a dog here and it shows up in the sidebar.
// Later, point `splat`, `scene`, and `animation` at that dog's own 3D assets
// without changing the UI code.

export const DOGS = [
  {
    id: "snoopy",
    name: "Snoopy",
    age: "6 months",
    breed: "Beagle",
    gender: "Female",
    photo: "/dogs/snoopy.png",
    personality: "Curious, food-motivated, and sure every stick is treasure. Loves pets, tennis balls, and pretending she invented the woods.",
    splat: { url: "/dog_model.spz" },
    scene: "woods",
    animation: null,
  },
  {
    id: "woodie",
    name: "Woodie",
    age: "2 years",
    breed: "Beagle mix",
    gender: "Male",
    photo: "/dogs/woodie.svg",
    personality: "Always two steps behind the fun and one treat ahead of trouble. Howls along with birds, then looks very surprised.",
    splat: { url: null },
    scene: "woods",
    animation: null,
  },
  {
    id: "daisy",
    name: "Daisy",
    age: "1 year",
    breed: "Corgi",
    gender: "Female",
    photo: "/dogs/daisy.svg",
    personality: "A loaf with opinions. Will herd your shoes, then fall asleep on them as if that was the plan all along.",
    splat: { url: null },
    scene: "office",
    animation: null,
  },
  {
    id: "pepper",
    name: "Pepper",
    age: "4 years",
    breed: "Terrier mix",
    gender: "Male",
    photo: "/dogs/pepper.svg",
    personality: "Small, brave, and certain he is in charge of the path. Collects interesting pebbles. Does not share pebbles.",
    splat: { url: null },
    scene: "woods",
    animation: null,
  },
];
