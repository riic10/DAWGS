import { DOGS } from "./dogs.js";
import "./sidebar.css";

export function createSidebar({ onSelect } = {}) {
  const photo = document.getElementById("adopt-photo");
  const name = document.getElementById("adopt-name");
  const age = document.getElementById("adopt-age");
  const breed = document.getElementById("adopt-breed");
  const gender = document.getElementById("adopt-gender");
  const bio = document.getElementById("adopt-bio");
  const count = document.getElementById("adopt-count");
  const prev = document.getElementById("adopt-prev");
  const next = document.getElementById("adopt-next");

  let index = 0;

  function show(i) {
    index = (i + DOGS.length) % DOGS.length;
    const dog = DOGS[index];
    photo.src = dog.photo;
    photo.alt = dog.name;
    name.textContent = dog.name;
    age.textContent = dog.age;
    breed.textContent = dog.breed;
    gender.textContent = dog.gender;
    bio.textContent = dog.personality;
    count.textContent = `${index + 1} / ${DOGS.length}`;
    onSelect?.(dog, index);
  }

  prev.addEventListener("click", () => show(index - 1));
  next.addEventListener("click", () => show(index + 1));
  show(0);

  return {
    dogs: DOGS,
    get index() { return index; },
    get current() { return DOGS[index]; },
    show,
    prev: () => show(index - 1),
    next: () => show(index + 1),
  };
}
