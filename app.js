const MANIFEST_PATH = 'aircraft_quiz_assets/manifest.json';
const ASSET_FOLDER = 'aircraft_quiz_assets';

// =========================================================
// DOM elements
// =========================================================

const categorySelect = document.getElementById('category');
const modeSelect = document.getElementById('mode');

const imageElement = document.getElementById('aircraft-image');
const loadingMessage = document.getElementById('loading-message');

const promptElement = document.getElementById('prompt');

const answerButtons = [...document.querySelectorAll('#answers button')];

const scoreElement = document.getElementById('score');
const feedbackElement = document.getElementById('feedback');
const streakElement = document.getElementById('streak');
const nextButton = document.getElementById('next');

// =========================================================
// State
// =========================================================

let aircraft = [];

let currentAircraft = null;
let currentQuestionType = null;

let previousAircraft = null;

/*
 * Aircraft remaining in the current shuffled cycle.
 *
 * An aircraft is not returned to the pool until the
 * current cycle has been completely exhausted.
 */
let aircraftQueue = [];

let score = 0;
let total = 0;
let streak = 0;

let answered = false;

// =========================================================
// Utility functions
// =========================================================

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomSample(items, count) {
  const copy = [...items];

  shuffle(copy);

  return copy.slice(0, count);
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

function displayText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

// =========================================================
// Image path
// =========================================================

function getImagePath(item) {
  const imagePath = displayText(item.image_path);

  if (!imagePath) {
    return '';
  }

  return `${ASSET_FOLDER}/${imagePath.replace(/^\/+/, '').replace(/\\/g, '/')}`;
}

// =========================================================
// Answer value
// =========================================================

function getAnswerValue(item, questionType) {
  if (questionType === 'Aircraft name') {
    return displayText(item.name);
  }

  return displayText(item.code);
}

// =========================================================
// Score
// =========================================================

function updateScore() {
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  scoreElement.textContent = `Score: ${score}/${total} (${percentage}%)`;

  streakElement.textContent = `Streak: ${streak}`;
}

// =========================================================
// Loading state
// =========================================================

function setLoading(isLoading) {
  if (isLoading) {
    imageElement.classList.add('loading');

    loadingMessage.classList.remove('hidden');

    answerButtons.forEach((button) => {
      button.disabled = true;
    });

    nextButton.disabled = true;

    return;
  }

  imageElement.classList.remove('loading');

  loadingMessage.classList.add('hidden');
}

// =========================================================
// Reset answer buttons
// =========================================================

function resetAnswerButtons() {
  answerButtons.forEach((button) => {
    button.disabled = false;

    button.classList.remove('correct', 'incorrect');

    button.textContent = '';
  });
}

// =========================================================
// Category population
// =========================================================

function populateCategories() {
  const categories = [
    ...new Set(
      aircraft.map((item) => displayText(item.category)).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

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

// =========================================================
// Get aircraft pool
// =========================================================

function getAircraftPool() {
  const selectedCategory = categorySelect.value;

  if (!selectedCategory || selectedCategory === 'All') {
    return [...aircraft];
  }

  return aircraft.filter(
    (item) => displayText(item.category) === selectedCategory,
  );
}

// =========================================================
// Choose aircraft
// =========================================================

function chooseAircraft() {
  let pool = getAircraftPool();

  /*
   * ICAO mode only allows aircraft with a valid code.
   */
  if (modeSelect.value === 'ICAO code') {
    pool = pool.filter((item) => getAnswerValue(item, 'ICAO code'));
  }

  /*
   * Mixed mode may ask for either the name or code,
   * so both must be available.
   */
  if (modeSelect.value === 'Mixed') {
    pool = pool.filter(
      (item) =>
        getAnswerValue(item, 'Aircraft name') &&
        getAnswerValue(item, 'ICAO code'),
    );
  }

  /*
   * If the selected category has fewer than four usable
   * aircraft, fall back to the full usable collection.
   */
  if (pool.length < 4) {
    pool = [...aircraft];

    if (modeSelect.value === 'ICAO code') {
      pool = pool.filter((item) => getAnswerValue(item, 'ICAO code'));
    }

    if (modeSelect.value === 'Mixed') {
      pool = pool.filter(
        (item) =>
          getAnswerValue(item, 'Aircraft name') &&
          getAnswerValue(item, 'ICAO code'),
      );
    }
  }

  if (pool.length === 0) {
    return null;
  }

  /*
   * Remove aircraft from the existing queue that are
   * no longer valid after a category/mode change.
   */
  const poolSet = new Set(pool);

  aircraftQueue = aircraftQueue.filter((item) => poolSet.has(item));

  /*
   * If the current cycle has finished, create a new
   * shuffled cycle containing every eligible aircraft.
   */
  if (aircraftQueue.length === 0) {
    aircraftQueue = [...pool];

    shuffle(aircraftQueue);
  }

  /*
   * Take the next aircraft from the cycle.
   */
  return aircraftQueue.pop();
}

// =========================================================
// Build answer choices
// =========================================================

function buildAnswerChoices(correctAircraft, questionType) {
  const correctAnswer = getAnswerValue(correctAircraft, questionType);

  /*
   * Only aircraft with a valid answer can be used.
   */
  const allUsableAircraft = aircraft.filter((item) =>
    getAnswerValue(item, questionType),
  );

  /*
   * Remove duplicate visible answers.
   *
   * This prevents two different aircraft records from
   * producing identical MCQ options.
   */
  const uniqueAircraft = [];
  const usedAnswers = new Set();

  for (const item of allUsableAircraft) {
    const answer = getAnswerValue(item, questionType);

    if (!usedAnswers.has(answer)) {
      usedAnswers.add(answer);
      uniqueAircraft.push(item);
    }
  }

  /*
   * Remove the correct aircraft from the distractor pool.
   */
  const distractorPool = uniqueAircraft.filter(
    (item) => item !== correctAircraft,
  );

  /*
   * Prefer distractors from the same category.
   */
  const sameCategory = distractorPool.filter(
    (item) =>
      item.category &&
      correctAircraft.category &&
      item.category === correctAircraft.category,
  );

  shuffle(sameCategory);
  shuffle(distractorPool);

  const distractors = [];

  /*
   * Take up to three same-category distractors.
   */
  for (const item of sameCategory) {
    if (distractors.length >= 3) {
      break;
    }

    const answer = getAnswerValue(item, questionType);

    const alreadyUsed = distractors.some(
      (selected) => getAnswerValue(selected, questionType) === answer,
    );

    if (answer !== correctAnswer && !alreadyUsed) {
      distractors.push(item);
    }
  }

  /*
   * Fill any remaining distractor slots from the
   * entire usable aircraft collection.
   */
  if (distractors.length < 3) {
    for (const item of distractorPool) {
      if (distractors.length >= 3) {
        break;
      }

      const answer = getAnswerValue(item, questionType);

      const alreadyUsed = distractors.some(
        (selected) => getAnswerValue(selected, questionType) === answer,
      );

      if (answer !== correctAnswer && !alreadyUsed) {
        distractors.push(item);
      }
    }
  }

  /*
   * Combine correct answer and distractors.
   */
  const choices = [correctAircraft, ...distractors];

  /*
   * Randomise the answer positions.
   */
  shuffle(choices);

  return choices.map((item) => ({
    aircraft: item,
    text: getAnswerValue(item, questionType),
  }));
}

// =========================================================
// Choose question type
// =========================================================

function chooseQuestionType() {
  if (modeSelect.value === 'Mixed') {
    return Math.random() < 0.5 ? 'Aircraft name' : 'ICAO code';
  }

  return modeSelect.value;
}

// =========================================================
// Display question
// =========================================================

function displayQuestion() {
  if (currentQuestionType === 'Aircraft name') {
    promptElement.textContent = 'Which aircraft is this?';
  } else {
    promptElement.textContent = 'What is the ICAO code?';
  }

  /*
   * Display the aircraft category as a small inline
   * hint beside the question.
   */
  const category = displayText(currentAircraft.category);

  if (category) {
    const categorySpan = document.createElement('span');

    categorySpan.className = 'category-hint';

    categorySpan.textContent = category;

    promptElement.appendChild(categorySpan);
  }
}

// =========================================================
// Display answer choices
// =========================================================

function displayAnswerChoices(choices) {
  answerButtons.forEach((button, index) => {
    const choice = choices[index];

    if (!choice) {
      button.textContent = '';
      button.disabled = true;
      button.hidden = true;
      return;
    }

    button.hidden = false;

    button.textContent = choice.text;

    button.dataset.answer = choice.text;
    button.dataset.correct =
      choice.aircraft === currentAircraft ? 'true' : 'false';

    button.disabled = false;
  });
}

// =========================================================
// Load next question
// =========================================================

function nextQuestion() {
  answered = false;

  feedbackElement.textContent = '';

  nextButton.disabled = true;

  resetAnswerButtons();

  answerButtons.forEach((button) => {
    button.hidden = false;
  });

  setLoading(true);

  const nextAircraft = chooseAircraft();

  if (!nextAircraft) {
    setLoading(false);

    promptElement.textContent = 'Not enough aircraft available.';

    answerButtons.forEach((button) => {
      button.disabled = true;
    });

    return;
  }

  currentAircraft = nextAircraft;

  previousAircraft = currentAircraft;

  currentQuestionType = chooseQuestionType();

  displayQuestion();

  const choices = buildAnswerChoices(currentAircraft, currentQuestionType);

  displayAnswerChoices(choices);

  const imagePath = getImagePath(currentAircraft);

  if (!imagePath) {
    setLoading(false);

    feedbackElement.textContent = 'Image unavailable.';

    answerButtons.forEach((button) => {
      button.disabled = true;
    });

    return;
  }

  /*
   * Wait for the image to actually load before enabling
   * the question.
   */
  imageElement.onload = () => {
    setLoading(false);
  };

  imageElement.onerror = () => {
    setLoading(false);

    feedbackElement.textContent = 'Unable to load aircraft image.';

    answerButtons.forEach((button) => {
      button.disabled = true;
    });
  };

  imageElement.src = imagePath;

  imageElement.alt = 'Aircraft recognition question image';
}

// =========================================================
// Answer question
// =========================================================

function answerQuestion(button) {
  if (answered) {
    return;
  }

  if (!currentAircraft) {
    return;
  }

  answered = true;

  const selectedAnswer = button.dataset.answer;

  const correctAnswer = getAnswerValue(currentAircraft, currentQuestionType);

  const isCorrect = selectedAnswer === correctAnswer;

  total += 1;

  if (isCorrect) {
    score += 1;
    streak += 1;

    feedbackElement.textContent = 'Correct!';

    button.classList.add('correct');
  } else {
    streak = 0;

    feedbackElement.textContent = `Correct answer: ${correctAnswer}`;

    button.classList.add('incorrect');

    /*
     * Highlight the correct answer as well.
     */
    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.answer === correctAnswer) {
        answerButton.classList.add('correct');
      }
    });
  }

  /*
   * Prevent further answers.
   */
  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;
  });

  nextButton.disabled = false;

  updateScore();

  /*
   * Move keyboard focus to Next so the next question
   * can be reached without tabbing through all answers.
   */
  nextButton.focus();
}

// =========================================================
// Load manifest
// =========================================================

async function loadManifest() {
  const response = await fetch(MANIFEST_PATH);

  if (!response.ok) {
    throw new Error(`Unable to load manifest (${response.status})`);
  }

  const manifest = await response.json();

  if (!manifest || !Array.isArray(manifest.aircraft)) {
    throw new Error('Invalid manifest: expected an aircraft array.');
  }

  aircraft = manifest.aircraft.filter(
    (item) => item && typeof item === 'object' && displayText(item.image_path),
  );

  if (aircraft.length === 0) {
    throw new Error('Manifest contains no usable aircraft.');
  }
}

// =========================================================
// Event listeners
// =========================================================

answerButtons.forEach((button) => {
  button.addEventListener('click', () => {
    answerQuestion(button);
  });
});

nextButton.addEventListener('click', () => {
  nextQuestion();
});

categorySelect.addEventListener('change', () => {
  /*
   * Changing category creates a completely new cycle.
   */
  aircraftQueue = [];

  nextQuestion();
});

modeSelect.addEventListener('change', () => {
  /*
   * Changing question mode creates a completely new
   * cycle because the eligible aircraft may change.
   */
  aircraftQueue = [];

  nextQuestion();
});

// =========================================================
// Keyboard controls
// =========================================================

document.addEventListener('keydown', (event) => {
  /*
   * Space or Enter moves to the next question after
   * an answer has been submitted.
   */
  if (answered && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();

    nextButton.click();

    return;
  }

  /*
   * Number keys 1-4 select answer choices.
   */
  if (!answered) {
    const key = event.key;

    if (key >= '1' && key <= '4') {
      const index = Number(key) - 1;

      const button = answerButtons[index];

      if (button && !button.disabled && !button.hidden) {
        event.preventDefault();

        button.click();
      }
    }
  }
});

// =========================================================
// Startup
// =========================================================

async function start() {
  try {
    setLoading(true);

    await loadManifest();

    populateCategories();

    updateScore();

    nextQuestion();
  } catch (error) {
    console.error(error);

    setLoading(false);

    promptElement.textContent = 'Unable to load aircraft data.';

    feedbackElement.textContent = error.message;

    answerButtons.forEach((button) => {
      button.disabled = true;
    });
  }
}

start();
