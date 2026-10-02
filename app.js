'use strict';

/* =========================================================
   Configuration
   ========================================================= */

const MANIFEST_PATH = 'aircraft_quiz_assets/manifest.json';

const ASSET_FOLDER = 'aircraft_quiz_assets';

/* =========================================================
   DOM elements
   ========================================================= */

const scoreElement = document.getElementById('score');

const categorySelect = document.getElementById('category');

const modeSelect = document.getElementById('mode');

const imageContainer = document.getElementById('image-container');

const loadingMessage = document.getElementById('loading-message');

const aircraftImage = document.getElementById('aircraft-image');

const promptElement = document.getElementById('prompt');

const answersContainer = document.getElementById('answers');

const answerButtons = Array.from(document.querySelectorAll('#answers button'));

const feedbackElement = document.getElementById('feedback');

const streakElement = document.getElementById('streak');

const nextButton = document.getElementById('next');

/* =========================================================
   Quiz state
   ========================================================= */

let aircraft = [];

let currentAircraft = null;

let currentCorrectAnswer = '';

let currentQuestionType = '';

let previousAircraft = null;

let score = 0;

let totalQuestions = 0;

let currentStreak = 0;

let answered = false;

let imageLoading = false;

/* =========================================================
   Utility functions
   ========================================================= */

function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomSample(array, count) {
  const copy = [...array];

  shuffle(copy);

  return copy.slice(0, count);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

function displayText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value);
}

/* =========================================================
   Image path handling
   ========================================================= */

function resolveImagePath(imagePath) {
  if (!imagePath) {
    return '';
  }

  /*
   * If the manifest already contains a full URL,
   * leave it alone.
   */

  if (
    imagePath.startsWith('http://') ||
    imagePath.startsWith('https://') ||
    imagePath.startsWith('/')
  ) {
    return imagePath;
  }

  /*
   * Manifest paths are relative to the aircraft
   * asset folder.
   */

  return `${ASSET_FOLDER}/${imagePath}`;
}

/* =========================================================
   Score display
   ========================================================= */

function updateScore() {
  const percentage =
    totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

  if (totalQuestions === 0) {
    scoreElement.textContent = 'Score: 0/0';
  } else {
    scoreElement.textContent = `Score: ${score}/${totalQuestions} · ${percentage}%`;
  }

  streakElement.textContent = `Streak: ${currentStreak}`;
}

/* =========================================================
   Loading state
   ========================================================= */

function setLoadingState(loading) {
  imageLoading = loading;

  answersContainer.classList.toggle('loading', loading);

  imageContainer.classList.toggle('loading', loading);

  aircraftImage.classList.toggle('loading', loading);

  loadingMessage.classList.toggle('hidden', !loading);

  /*
   * Prevent answering before the aircraft image
   * has actually loaded.
   */

  answerButtons.forEach((button) => {
    button.disabled = loading || answered;
  });

  /*
   * Prevent advancing while the new aircraft
   * is still loading.
   */

  nextButton.disabled = loading || !answered;
}

/* =========================================================
   Reset answer button states
   ========================================================= */

function resetAnswerButtons() {
  answerButtons.forEach((button) => {
    button.classList.remove('correct', 'incorrect');

    button.disabled = true;

    button.textContent = '';
  });
}

/* =========================================================
   Populate categories
   ========================================================= */

function populateCategories() {
  const categories = [
    ...new Set(aircraft.map((item) => item.category).filter(Boolean)),
  ];

  categories.sort((a, b) => String(a).localeCompare(String(b)));

  categorySelect.innerHTML = '';

  const allOption = document.createElement('option');

  allOption.value = 'All';

  allOption.textContent = 'All';

  categorySelect.appendChild(allOption);

  categories.forEach((category) => {
    const option = document.createElement('option');

    option.value = category;

    option.textContent = category;

    categorySelect.appendChild(option);
  });
}

/* =========================================================
   Get aircraft pool
   ========================================================= */

function getAircraftPool() {
  const selectedCategory = categorySelect.value;

  if (selectedCategory === 'All') {
    return [...aircraft];
  }

  return aircraft.filter((item) => item.category === selectedCategory);
}

/* =========================================================
   Choose aircraft
   ========================================================= */

function chooseAircraft() {
  let pool = getAircraftPool();

  /*
   * If the selected category has fewer than four
   * aircraft, use the full collection so that
   * four answer choices can still be provided.
   */

  if (pool.length < 4) {
    pool = [...aircraft];
  }

  if (pool.length === 0) {
    return null;
  }

  /*
   * Avoid showing the same aircraft twice in a row.
   */

  let choices = pool.filter((item) => item !== previousAircraft);

  /*
   * If filtering removed everything, fall back
   * to the full pool.
   */

  if (choices.length === 0) {
    choices = pool;
  }

  return randomChoice(choices);
}

/* =========================================================
   Get answer value
   ========================================================= */

function getAnswerValue(item, questionType) {
  if (questionType === 'Aircraft name') {
    return displayText(item.name);
  }

  return displayText(item.icao);
}

/* =========================================================
   Build answer choices
   ========================================================= */

function buildAnswerChoices(correctAircraft, questionType) {
  let pool = getAircraftPool();

  /*
   * If the selected category doesn't contain
   * enough aircraft for four choices, use all aircraft.
   */

  if (pool.length < 4) {
    pool = [...aircraft];
  }

  /*
   * Remove the correct aircraft.
   */

  const distractorPool = pool.filter((item) => item !== correctAircraft);

  /*
   * Prefer distractors from the same category.
   */

  const sameCategory = distractorPool.filter(
    (item) =>
      item.category &&
      correctAircraft.category &&
      item.category === correctAircraft.category,
  );

  let distractors = [];

  if (sameCategory.length >= 3) {
    distractors = randomSample(sameCategory, 3);
  } else {
    distractors = randomSample(distractorPool, 3);
  }

  const choices = [correctAircraft, ...distractors];

  shuffle(choices);

  return choices.map((item) => ({
    aircraft: item,

    text: getAnswerValue(item, questionType),
  }));
}

/* =========================================================
   Determine question type
   ========================================================= */

function chooseQuestionType() {
  const mode = modeSelect.value;

  if (mode === 'Mixed') {
    return Math.random() < 0.5 ? 'Aircraft name' : 'ICAO code';
  }

  return mode;
}

/* =========================================================
   Load next question
   ========================================================= */

function nextQuestion() {
  if (imageLoading) {
    return;
  }

  answered = false;

  feedbackElement.textContent = '';

  resetAnswerButtons();

  const selectedAircraft = chooseAircraft();

  if (!selectedAircraft) {
    promptElement.textContent = 'No aircraft available.';

    return;
  }

  currentAircraft = selectedAircraft;

  previousAircraft = selectedAircraft;

  currentQuestionType = chooseQuestionType();

  currentCorrectAnswer = getAnswerValue(currentAircraft, currentQuestionType);

  /*
   * Build answer choices.
   */

  const choices = buildAnswerChoices(currentAircraft, currentQuestionType);

  /*
   * Update prompt.
   */

  if (currentQuestionType === 'Aircraft name') {
    promptElement.textContent = 'Which aircraft is this?';
  } else {
    promptElement.textContent = 'What is the ICAO code?';
  }

  /*
   * Populate answer buttons.
   */

  choices.forEach((choice, index) => {
    const button = answerButtons[index];

    button.textContent = choice.text;

    button.dataset.answer = choice.text;

    button.dataset.correct = String(choice.aircraft === currentAircraft);

    button.dataset.index = String(index);
  });

  /*
   * Clear previous image immediately.
   *
   * This prevents the previous aircraft from
   * briefly appearing while the new one loads.
   */

  aircraftImage.removeAttribute('src');

  aircraftImage.alt = 'Aircraft image';

  /*
   * Disable interaction until the image loads.
   */

  setLoadingState(true);

  /*
   * Load the new aircraft image.
   */

  const imagePath = resolveImagePath(currentAircraft.image_path);

  aircraftImage.onload = () => {
    setLoadingState(false);
  };

  aircraftImage.onerror = () => {
    setLoadingState(false);

    answerButtons.forEach((button) => {
      button.disabled = true;
    });

    nextButton.disabled = true;

    feedbackElement.textContent = 'Unable to load this aircraft image.';
  };

  aircraftImage.src = imagePath;
}

/* =========================================================
   Answer question
   ========================================================= */

function answer(button) {
  /*
   * Ignore clicks while loading or after answering.
   */

  if (imageLoading || answered || !currentAircraft) {
    return;
  }

  answered = true;

  const isCorrect = button.dataset.correct === 'true';

  totalQuestions++;

  if (isCorrect) {
    score++;

    currentStreak++;

    feedbackElement.textContent = 'Correct!';
  } else {
    currentStreak = 0;

    feedbackElement.textContent = `Incorrect. Correct answer: ${currentCorrectAnswer}`;
  }

  /*
   * Disable every answer.
   */

  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;

    answerButton.classList.remove('correct', 'incorrect');

    /*
     * Always show the correct answer.
     */

    if (answerButton.dataset.correct === 'true') {
      answerButton.classList.add('correct');
    }
  });

  /*
   * Highlight the user's incorrect choice.
   */

  if (!isCorrect) {
    button.classList.add('incorrect');
  }

  updateScore();

  /*
   * Allow the user to move to the next aircraft.
   */

  nextButton.disabled = false;
}

/* =========================================================
   Load manifest
   ========================================================= */

async function loadAircraft() {
  try {
    const response = await fetch(MANIFEST_PATH);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const manifest = await response.json();

    /*
     * Support either:
     *
     * { "aircraft": [...] }
     *
     * or simply:
     *
     * [...]
     */

    if (Array.isArray(manifest)) {
      aircraft = manifest;
    } else if (Array.isArray(manifest.aircraft)) {
      aircraft = manifest.aircraft;
    } else {
      throw new Error('Manifest does not contain an aircraft array.');
    }

    if (aircraft.length < 4) {
      throw new Error('At least four aircraft are required.');
    }

    populateCategories();

    updateScore();

    nextQuestion();
  } catch (error) {
    console.error(error);

    promptElement.textContent = 'Unable to load aircraft data.';

    feedbackElement.textContent =
      'Check that manifest.json and the aircraft images are available.';

    loadingMessage.textContent = 'Unable to load';

    loadingMessage.classList.remove('hidden');

    answerButtons.forEach((button) => {
      button.disabled = true;
    });

    nextButton.disabled = true;
  }
}

/* =========================================================
   Event listeners
   ========================================================= */

answerButtons.forEach((button) => {
  button.addEventListener('click', () => answer(button));
});

nextButton.addEventListener('click', nextQuestion);

categorySelect.addEventListener('change', () => {
  /*
   * Changing the category starts a fresh
   * question and keeps the existing score.
   */

  nextQuestion();
});

modeSelect.addEventListener('change', () => {
  /*
   * Changing the question type starts a
   * fresh question and keeps the existing score.
   */

  nextQuestion();
});

/* =========================================================
   Keyboard controls
   ========================================================= */

document.addEventListener('keydown', (event) => {
  /*
   * Don't hijack keyboard input while the user
   * is interacting with a select element.
   */

  if (event.target.tagName === 'SELECT') {
    return;
  }

  /*
   * Enter or Space advances after answering.
   */

  if (
    (event.key === 'Enter' || event.key === ' ') &&
    answered &&
    !imageLoading
  ) {
    event.preventDefault();

    nextQuestion();
  }
});

/* =========================================================
   Start
   ========================================================= */

loadAircraft();
