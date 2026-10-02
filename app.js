'use strict';

const APP_TITLE = 'Aircraft Recognition Trainer';

const MANIFEST_PATH = 'aircraft_quiz_assets/manifest.json';

// =============================================================
// State
// =============================================================

let aircraft = [];

let current = null;

let previousAircraft = null;

let options = [];

let total = 0;

let correct = 0;

let answered = false;

let activeMode = 'Aircraft name';

// =============================================================
// DOM elements
// =============================================================

const categorySelect = document.getElementById('category');

const modeSelect = document.getElementById('mode');

const image = document.getElementById('aircraft-image');

const prompt = document.getElementById('prompt');

const score = document.getElementById('score');

const feedback = document.getElementById('feedback');

const nextButton = document.getElementById('next');

const answerButtons = Array.from(document.querySelectorAll('#answers button'));

// =============================================================
// Load manifest
// =============================================================

async function loadAircraft() {
  let response;

  try {
    response = await fetch(MANIFEST_PATH);
  } catch (error) {
    throw new Error('Could not load aircraft manifest.\n\n' + error.message);
  }

  if (!response.ok) {
    throw new Error(
      `Could not load manifest.json.\n\n` + `HTTP ${response.status}`,
    );
  }

  let data;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error('manifest.json is not valid JSON.');
  }

  if (!Array.isArray(data.aircraft)) {
    throw new Error('manifest.json does not contain ' + 'an aircraft array.');
  }

  aircraft = data.aircraft.map((item) => {
    return {
      ...item,

      image_path: resolveImagePath(item.image_path),
    };
  });

  if (aircraft.length < 4) {
    throw new Error(
      `Only ${aircraft.length} aircraft ` +
        `were found.\n\n` +
        `At least 4 aircraft are required.`,
    );
  }
}

// =============================================================
// Resolve image path
// =============================================================

function resolveImagePath(imagePath) {
  /*
   * Relative paths in manifest.json are relative
   * to aircraft_quiz_assets.
   *
   * Example:
   *
   * p02_01_cessna_172.png
   *
   * becomes:
   *
   * aircraft_quiz_assets/p02_01_cessna_172.png
   */

  if (
    imagePath.startsWith('http://') ||
    imagePath.startsWith('https://') ||
    imagePath.startsWith('/')
  ) {
    return imagePath;
  }

  return 'aircraft_quiz_assets/' + imagePath;
}

// =============================================================
// Populate category selector
// =============================================================

function populateCategories() {
  const categories = [
    ...new Set(aircraft.map((item) => item.category).filter(Boolean)),
  ].sort();

  categorySelect.innerHTML = '';

  addOption(categorySelect, 'All', 'All');

  for (const category of categories) {
    addOption(categorySelect, category, category);
  }
}

// =============================================================
// Add select option
// =============================================================

function addOption(select, value, text) {
  const option = document.createElement('option');

  option.value = value;

  option.textContent = text;

  select.appendChild(option);
}

// =============================================================
// Get aircraft pool
// =============================================================

function getPool() {
  const category = categorySelect.value;

  if (category === 'All') {
    return aircraft;
  }

  const result = aircraft.filter((item) => item.category === category);

  /*
   * If the category has fewer than
   * four aircraft, fall back to all
   * aircraft so we can still provide
   * four answer choices.
   */

  if (result.length >= 4) {
    return result;
  }

  return aircraft;
}

// =============================================================
// Random choice
// =============================================================

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// =============================================================
// Random sample
// =============================================================

function randomSample(array, count) {
  const copy = [...array];

  const result = [];

  while (result.length < count && copy.length > 0) {
    const index = Math.floor(Math.random() * copy.length);

    result.push(copy.splice(index, 1)[0]);
  }

  return result;
}

// =============================================================
// Shuffle
// =============================================================

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

// =============================================================
// Get display text
// =============================================================

function displayText(item, mode) {
  if (mode === 'ICAO code') {
    return item.code || item.name;
  }

  return item.name;
}

// =============================================================
// Next question
// =============================================================

function nextQuestion() {
  const pool = getPool();

  if (pool.length < 4) {
    feedback.textContent = 'Not enough aircraft available.';

    return;
  }

  // ---------------------------------------------------------
  // Select aircraft
  //
  // Completely random except the previous aircraft cannot
  // immediately repeat.
  // ---------------------------------------------------------

  let available = pool;

  if (previousAircraft !== null && pool.length > 1) {
    available = pool.filter((item) => item.key !== previousAircraft.key);
  }

  current = randomChoice(available);

  previousAircraft = current;

  // ---------------------------------------------------------
  // Select question mode
  // ---------------------------------------------------------

  let mode = modeSelect.value;

  if (mode === 'Mixed') {
    mode = randomChoice(['Aircraft name', 'ICAO code']);
  }

  if (mode === 'ICAO code' && !current.code) {
    mode = 'Aircraft name';
  }

  activeMode = mode;

  // ---------------------------------------------------------
  // Select distractors
  // ---------------------------------------------------------

  const distractorPool = pool.filter((item) => item.key !== current.key);

  const sameCategory = distractorPool.filter(
    (item) => item.category === current.category,
  );

  let source;

  if (sameCategory.length >= 3) {
    source = sameCategory;
  } else {
    source = distractorPool;
  }

  const distractors = randomSample(source, 3);

  // ---------------------------------------------------------
  // Randomise answer positions
  // ---------------------------------------------------------

  options = shuffle([...distractors, current]);

  // ---------------------------------------------------------
  // Display image
  // ---------------------------------------------------------

  image.src = current.image_path;

  image.alt = current.name;

  // ---------------------------------------------------------
  // Prompt
  // ---------------------------------------------------------

  prompt.textContent =
    `Identify the ${activeMode.toLowerCase()}` + `  |  ` + current.category;

  // ---------------------------------------------------------
  // Answer buttons
  // ---------------------------------------------------------

  answerButtons.forEach((button, index) => {
    const option = options[index];

    button.textContent = displayText(option, activeMode);

    button.disabled = false;
  });

  // ---------------------------------------------------------
  // Reset
  // ---------------------------------------------------------

  feedback.textContent = '';

  feedback.style.color = '';

  answered = false;
}

// =============================================================
// Answer
// =============================================================

function answer(index) {
  if (answered || current === null) {
    return;
  }

  answered = true;

  const chosen = options[index];

  const isCorrect = chosen.key === current.key;

  total++;

  if (isCorrect) {
    correct++;
  }

  // ---------------------------------------------------------
  // Answer text
  // ---------------------------------------------------------

  let answerText = current.name;

  if (current.code) {
    answerText += ` (${current.code})`;
  }

  if (isCorrect) {
    feedback.textContent = `Correct: ${answerText}`;

    feedback.style.color = '#147a3d';
  } else {
    feedback.textContent = `Not quite. Answer: ${answerText}`;

    feedback.style.color = '#b42318';
  }

  // ---------------------------------------------------------
  // Score
  // ---------------------------------------------------------

  score.textContent = `Score: ${correct}/${total}`;

  // ---------------------------------------------------------
  // Disable answers
  // ---------------------------------------------------------

  answerButtons.forEach((button) => {
    button.disabled = true;
  });
}

// =============================================================
// Event handlers
// =============================================================

answerButtons.forEach((button, index) => {
  button.addEventListener('click', () => answer(index));
});

nextButton.addEventListener('click', nextQuestion);

categorySelect.addEventListener('change', nextQuestion);

modeSelect.addEventListener('change', nextQuestion);

// =============================================================
// Keyboard shortcuts
// =============================================================

document.addEventListener('keydown', (event) => {
  if (event.key === ' ' || event.key === 'Enter') {
    if (answered) {
      event.preventDefault();

      nextQuestion();
    }
  }
});

// =============================================================
// Initialisation
// =============================================================

async function init() {
  try {
    await loadAircraft();

    populateCategories();

    nextQuestion();
  } catch (error) {
    console.error(error);

    document.body.innerHTML = `
            <div style="
                padding: 30px;
                font-family: Segoe UI, Arial, sans-serif;
            ">
                <h2>
                    ${APP_TITLE}
                </h2>

                <p>
                    Could not load aircraft assets.
                </p>

                <pre style="
                    white-space: pre-wrap;
                ">${escapeHtml(error.message)}</pre>
            </div>
        `;
  }
}

// =============================================================
// Escape HTML for error messages
// =============================================================

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start.
init();
