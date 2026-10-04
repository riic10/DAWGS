import { DOGS } from "./dogs.js";
import "./sidebar.css";

// True when a roster entry has a 3D model to put in the scene.
export const hasModel = (dog) => Boolean(dog?.splat?.url || dog?.splat?.fileBytes);

// onSelect(dog, index): a dog was shown. onUpload(): "Upload your dog".
// onRename(dog): ✎ on the uploaded dog's card.
export function createSidebar({ onSelect, onUpload, onRename } = {}) {
  const photo = document.getElementById("adopt-photo");
  const name = document.getElementById("adopt-name");
  const age = document.getElementById("adopt-age");
  const breed = document.getElementById("adopt-breed");
  const gender = document.getElementById("adopt-gender");
  const bio = document.getElementById("adopt-bio");
  const note = document.getElementById("adopt-note");
  const count = document.getElementById("adopt-count");
  const prev = document.getElementById("adopt-prev");
  const next = document.getElementById("adopt-next");
  const rename = document.getElementById("adopt-rename");
  const upload = document.getElementById("adopt-upload");
  const card = document.getElementById("adopt");

  const dogs = [...DOGS]; // plus the uploaded dog, when there is one
  let index = 0;

  // Fill the card. Text goes in through textContent only: names can be typed by users.
  function render() {
    const dog = dogs[index];
    photo.src = dog.photo;
    photo.alt = dog.name;
    name.textContent = dog.name;
    age.textContent = dog.age;
    breed.textContent = dog.breed;
    gender.textContent = dog.gender;
    bio.textContent = dog.personality;
    count.textContent = `${index + 1} / ${dogs.length}`;
    note.hidden = hasModel(dog);
    rename.hidden = dog.id !== "upload";
  }

  function show(i) {
    index = (i + dogs.length) % dogs.length;
    render();
    onSelect?.(dogs[index], index);
  }

  prev.addEventListener("click", () => show(index - 1));
  next.addEventListener("click", () => show(index + 1));
  upload.addEventListener("click", () => onUpload?.());
  rename.addEventListener("click", () => onRename?.(dogs[index]));
  show(0);

  return {
    dogs,
    get index() { return index; },
    get current() { return dogs[index]; },
    show,
    prev: () => show(index - 1),
    next: () => show(index + 1),

    // Add or replace the one uploaded dog (id "upload") and show it.
    setUploaded(entry) {
      // Flash the card so it's clear the new dog joined the roster.
      card.classList.remove("adopt-new");
      void card.offsetWidth; // restart the animation
      card.classList.add("adopt-new");
      const at = dogs.findIndex((d) => d.id === "upload");
      if (at >= 0) {
        if (dogs[at].photo !== entry.photo) URL.revokeObjectURL(dogs[at].photo);
        dogs[at] = entry;
        show(at);
      } else {
        dogs.push(entry);
        show(dogs.length - 1);
      }
    },

    // Rename the uploaded dog without reloading its model.
    renameUploaded(newName) {
      const dog = dogs.find((d) => d.id === "upload");
      if (!dog) return;
      dog.name = newName;
      if (dogs[index] === dog) render();
    },
  };
}
