const MANIFEST_PATH = 'manifest.json';

// =========================================================
// DOM elements
// =========================================================

const appElement = document.querySelector('.app');
const categorySelect = document.getElementById('category');
const modeSelect = document.getElementById('mode');
const answerModeSelect = document.getElementById('answer-mode');
const imageContainer = document.getElementById('image-container');
const imageElement = document.getElementById('aircraft-image');
const loadingMessage = document.getElementById('loading-message');
const promptElement = document.getElementById('prompt');
const typeAnswerContainer = document.getElementById('type-answer-container');
const typeAnswerInput = document.getElementById('type-answer-input');
const submitAnswerButton = document.getElementById('submit-answer');
const answerContainer = document.getElementById('answers');
const answerButtons = [...document.querySelectorAll('#answers button')];
const scoreElement = document.getElementById('score');
const feedbackElement = document.getElementById('feedback');
const nextButton = document.getElementById('next');

// =========================================================
// State
// =========================================================

let aircraft = [];
let currentAircraft = null;
let currentQuestionType = null;
let currentChoices = [];
let aircraftQueue = [];
let score = 0;
let total = 0;
let answered = false;

/*
  Each aircraft type has its own image shuffle bag.

  An image is removed from the bag when used.
  Once all images have been used, the bag is
  automatically rebuilt and reshuffled.
*/

const imageBags = new Map();

// =========================================================
// Accessibility setup
// =========================================================

function setupAccessibility() {
  if (appElement) {
    appElement.setAttribute('aria-describedby', 'keyboard-shortcuts-help');
  }

  if (promptElement) {
    promptElement.setAttribute('aria-live', 'polite');
    promptElement.setAttribute('aria-atomic', 'true');
    promptElement.setAttribute('tabindex', '-1');
  }

  if (feedbackElement) {
    feedbackElement.setAttribute('aria-live', 'polite');
    feedbackElement.setAttribute('aria-atomic', 'true');
  }

  if (scoreElement) {
    scoreElement.setAttribute('aria-live', 'polite');
    scoreElement.setAttribute('aria-atomic', 'true');
  }

  if (loadingMessage) {
    loadingMessage.setAttribute('role', 'status');
    loadingMessage.setAttribute('aria-live', 'polite');
    loadingMessage.setAttribute('aria-atomic', 'true');
  }

  if (answerContainer) {
    answerContainer.setAttribute('aria-label', 'Answer choices');
  }

  let shortcutHelp = document.getElementById('keyboard-shortcuts-help');

  if (!shortcutHelp) {
    shortcutHelp = document.createElement('div');
    shortcutHelp.id = 'keyboard-shortcuts-help';
    shortcutHelp.className = 'visually-hidden';

    shortcutHelp.textContent =
      'Keyboard shortcuts: ' +
      '1 through 4 select an answer. ' +
      'Arrow keys move between answer choices. ' +
      'Home selects the first answer and End selects the last. ' +
      'Enter or Space activates the focused answer. ' +
      'Enter submits a typed answer. ' +
      'N moves to the next question after an answer has been submitted.';

    document.body.appendChild(shortcutHelp);
  }

  answerButtons.forEach((button, index) => {
    button.setAttribute('aria-keyshortcuts', String(index + 1));
  });

  nextButton.setAttribute('aria-keyshortcuts', 'Enter Space N');
  submitAnswerButton.setAttribute('aria-keyshortcuts', 'Enter');
}

// =========================================================
// Utility functions
// =========================================================

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
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
// Grammar helpers
// =========================================================

function getIndefiniteArticle(text) {
  const value = displayText(text);

  if (!value) {
    return 'a';
  }

  const firstWord = value
    .replace(/^[^A-Za-z0-9]+/, '')
    .split(/\s+/)[0]
    .toLowerCase();

  if (
    /^(a|e|i|o|u)/.test(firstWord) ||
    /^(honest|hour|heir|honour|airbus|embraer|antonov|ilyushin|aviation)/.test(
      firstWord,
    )
  ) {
    return 'an';
  }

  return 'a';
}

function formatPointsWithGrammar(points) {
  const formattedPoints = formatPoints(points);

  return `${formattedPoints} ${Number(points) === 1 ? 'point' : 'points'}`;
}

// =========================================================
// Image handling
// =========================================================

function getAircraftImages(item) {
  if (!item || !Array.isArray(item.images)) {
    return [];
  }

  return item.images.map((filename) => displayText(filename)).filter(Boolean);
}

function buildImagePath(item, filename) {
  const folder = displayText(item?.folder);
  const imageFilename = displayText(filename);

  if (!folder || !imageFilename) {
    return '';
  }

  return `${encodeURIComponent(folder)}/${encodeURIComponent(imageFilename)}`;
}

function getImageBagKey(item) {
  return getAircraftTypeKey(item);
}

function getRandomImagePath(item) {
  const images = getAircraftImages(item);

  if (images.length === 0) {
    return '';
  }

  const bagKey = getImageBagKey(item);

  if (!bagKey) {
    return '';
  }

  let bag = imageBags.get(bagKey);

  if (!Array.isArray(bag) || bag.length === 0) {
    bag = shuffle([...images]);
    imageBags.set(bagKey, bag);
  }

  const filename = bag.pop();

  return buildImagePath(item, filename);
}

function getRandomChoiceImagePath(item) {
  const images = getAircraftImages(item);

  if (images.length === 0) {
    return '';
  }

  const filename = images[Math.floor(Math.random() * images.length)];

  return buildImagePath(item, filename);
}

// =========================================================
// Answer value
// =========================================================

/*
  What the user actually selects/types.

  Aircraft name:
    "Boeing 737-700 (B737)"
        ->
    "Boeing 737-700"

  ICAO:
    "B737"
        ->
    "B737"

  The ICAO is intentionally removed from aircraft-name
  choices and typed-answer validation.
*/

function getAnswerValue(item, questionType) {
  if (questionType === 'Aircraft name') {
    const label = displayText(item?.label);

    return label.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  return displayText(item?.code);
}

/*
  What is shown in feedback.

  Aircraft name feedback keeps the full manifest label,
  including the ICAO code.

  Example:
    Boeing 737-700 (B737)

  ICAO feedback remains:
    B737
*/

function getFeedbackAnswer(item, questionType) {
  if (questionType === 'ICAO code') {
    return `${displayText(item?.code)} (${displayText(item?.label)
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim()})`;
  }

  return displayText(item?.label);
}

// =========================================================
// Aircraft type identity
// =========================================================

function getAircraftTypeKey(item) {
  const folder = displayText(item?.folder).toLowerCase();

  if (folder) {
    return `folder:${folder}`;
  }

  return '';
}

// =========================================================
// Score
// =========================================================

function updateScore() {
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  scoreElement.textContent = `Score: ${score}/${total} (${percentage}%)`;
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

    typeAnswerInput.disabled = true;
    submitAnswerButton.disabled = true;
    nextButton.disabled = true;

    return;
  }

  imageElement.classList.remove('loading');
  loadingMessage.classList.add('hidden');
}

// =========================================================
// Reset answer UI
// =========================================================

function resetAnswerUI() {
  answerButtons.forEach((button, index) => {
    button.disabled = true;
    button.hidden = false;
    button.classList.remove('correct', 'incorrect');
    button.textContent = '';
    button.replaceChildren();

    delete button.dataset.answer;
    delete button.dataset.correct;

    button.setAttribute('aria-label', `Answer option ${index + 1}`);
  });

  answerContainer.classList.remove('reverse');

  typeAnswerContainer.hidden = true;
  typeAnswerInput.value = '';

  typeAnswerInput.classList.remove('correct', 'partial', 'incorrect');

  typeAnswerContainer.classList.remove('correct', 'partial', 'incorrect');

  feedbackElement.classList.remove(
    'correct-feedback',
    'partial-feedback',
    'incorrect-feedback',
  );

  typeAnswerInput.disabled = true;
  submitAnswerButton.disabled = true;

  imageContainer.hidden = false;
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
// Get valid aircraft for current question mode
// =========================================================

function getValidAircraftPool() {
  let pool = getAircraftPool();

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

  /*
    If the selected category contains fewer than four usable
    aircraft, fall back to the full usable aircraft collection.
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

  return pool;
}

// =========================================================
// Choose aircraft using type-based shuffle-bag
// =========================================================

function chooseAircraft() {
  const pool = getValidAircraftPool();

  if (pool.length === 0) {
    return null;
  }

  const aircraftByType = new Map();

  for (const item of pool) {
    const typeKey = getAircraftTypeKey(item);

    if (!typeKey) {
      continue;
    }

    if (!aircraftByType.has(typeKey)) {
      aircraftByType.set(typeKey, []);
    }

    aircraftByType.get(typeKey).push(item);
  }

  if (aircraftByType.size === 0) {
    return null;
  }

  const availableTypeKeys = new Set(aircraftByType.keys());

  aircraftQueue = aircraftQueue.filter((item) =>
    availableTypeKeys.has(getAircraftTypeKey(item)),
  );

  if (aircraftQueue.length === 0) {
    aircraftQueue = [...aircraftByType.values()].map((entries) => entries[0]);

    shuffle(aircraftQueue);
  }

  const typeRepresentative = aircraftQueue.pop();
  const typeKey = getAircraftTypeKey(typeRepresentative);
  const photosForType = aircraftByType.get(typeKey);

  if (!photosForType || photosForType.length === 0) {
    return typeRepresentative;
  }

  return photosForType[Math.floor(Math.random() * photosForType.length)];
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
// Build text answer choices
// =========================================================

function buildTextAnswerChoices(correctAircraft, questionType) {
  const correctAnswer = getAnswerValue(correctAircraft, questionType);

  const usableAircraft = aircraft.filter((item) =>
    getAnswerValue(item, questionType),
  );

  const uniqueAircraft = [correctAircraft];
  const usedAnswers = new Set([correctAnswer]);

  for (const item of usableAircraft) {
    if (item === correctAircraft) {
      continue;
    }

    const answer = getAnswerValue(item, questionType);

    if (!usedAnswers.has(answer)) {
      usedAnswers.add(answer);
      uniqueAircraft.push(item);
    }
  }

  const distractorPool = uniqueAircraft.slice(1);

  const sameCategory = distractorPool.filter(
    (item) =>
      displayText(item.category) &&
      displayText(correctAircraft.category) &&
      item.category === correctAircraft.category,
  );

  shuffle(sameCategory);
  shuffle(distractorPool);

  const distractors = [];

  for (const item of sameCategory) {
    if (distractors.length >= 3) {
      break;
    }

    const answer = getAnswerValue(item, questionType);

    if (
      answer !== correctAnswer &&
      !distractors.some(
        (selected) => getAnswerValue(selected, questionType) === answer,
      )
    ) {
      distractors.push(item);
    }
  }

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

  const choices = [correctAircraft, ...distractors];

  shuffle(choices);

  return choices.map((item) => ({
    aircraft: item,
    text: getAnswerValue(item, questionType),
  }));
}

// =========================================================
// Build reverse photo choices
// =========================================================

function buildPhotoChoices(correctAircraft) {
  const correctCategory = displayText(correctAircraft?.category);

  const categoryPool = aircraft.filter((item) => {
    return (
      displayText(item?.category) === correctCategory &&
      getAircraftImages(item).length > 0 &&
      displayText(item?.folder)
    );
  });

  const uniqueByType = new Map();

  for (const item of categoryPool) {
    const typeKey = getAircraftTypeKey(item);

    if (!typeKey) {
      continue;
    }

    if (item === correctAircraft || !uniqueByType.has(typeKey)) {
      uniqueByType.set(typeKey, item);
    }
  }

  const correctTypeKey = getAircraftTypeKey(correctAircraft);

  uniqueByType.set(correctTypeKey, correctAircraft);

  const distractors = [...uniqueByType.values()].filter(
    (item) =>
      getAircraftTypeKey(item) !== correctTypeKey &&
      displayText(item.category) === correctCategory,
  );

  shuffle(distractors);

  const choices = [
    correctAircraft,
    distractors[0],
    distractors[1],
    distractors[2],
  ];

  if (choices.some((item) => !item)) {
    console.error('Could not create 4 same-category aircraft choices.', {
      correctAircraft,
      category: correctCategory,
      choices,
    });
  }

  shuffle(choices);

  return choices.map((item) => ({
    aircraft: item,
    text: getAnswerValue(item, currentQuestionType),
  }));
}

// =========================================================
// Display question
// =========================================================

function displayQuestion() {
  promptElement.replaceChildren();

  let questionText;

  if (answerModeSelect.value === 'reverse') {
    const aircraftName = getAnswerValue(currentAircraft, currentQuestionType);

    questionText = `Which photo is ${getIndefiniteArticle(
      aircraftName,
    )} ${aircraftName}?`;
  } else if (currentQuestionType === 'Aircraft name') {
    questionText = 'Which aircraft is this?';
  } else {
    questionText = 'What is the ICAO code?';
  }

  promptElement.appendChild(document.createTextNode(questionText));

  const category = displayText(currentAircraft.category);

  if (category) {
    const categorySpan = document.createElement('span');

    categorySpan.className = 'category-hint';
    categorySpan.textContent = category;

    categorySpan.setAttribute('aria-label', `Category: ${category}`);

    promptElement.appendChild(categorySpan);
  }
}

// =========================================================
// Display text answer choices
// =========================================================

function displayTextAnswerChoices(choices) {
  answerContainer.classList.remove('reverse');

  answerButtons.forEach((button, index) => {
    const choice = choices[index];

    if (!choice) {
      button.textContent = '';
      button.disabled = true;
      button.hidden = true;
      button.setAttribute('aria-hidden', 'true');
      return;
    }

    button.hidden = false;
    button.removeAttribute('aria-hidden');
    button.replaceChildren();

    button.textContent = choice.text;
    button.dataset.answer = choice.text;

    button.dataset.correct =
      choice.aircraft === currentAircraft ? 'true' : 'false';

    button.disabled = false;

    button.setAttribute('aria-label', `Option ${index + 1}: ${choice.text}`);
  });
}

// =========================================================
// Display reverse photo choices
// =========================================================

function displayPhotoAnswerChoices(choices) {
  answerContainer.classList.add('reverse');

  answerButtons.forEach((button, index) => {
    const choice = choices[index];

    if (!choice) {
      button.replaceChildren();
      button.disabled = true;
      button.hidden = true;
      button.setAttribute('aria-hidden', 'true');
      return;
    }

    button.hidden = false;
    button.removeAttribute('aria-hidden');
    button.replaceChildren();

    const img = document.createElement('img');

    img.src = getRandomChoiceImagePath(choice.aircraft);
    img.alt = `Aircraft photo option ${index + 1}`;
    img.draggable = false;

    const name = document.createElement('span');

    name.className = 'photo-choice-name hidden-name';
    name.textContent = choice.text;

    name.setAttribute('aria-label', `Answer: ${choice.text}`);

    button.appendChild(img);
    button.appendChild(name);

    button.dataset.answer = choice.text;

    button.dataset.correct =
      choice.aircraft === currentAircraft ? 'true' : 'false';

    button.disabled = false;

    button.setAttribute('aria-label', `Photo option ${index + 1}`);
  });
}

// =========================================================
// Normalise typed answers
// =========================================================

function normaliseAnswer(value) {
  return displayText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// =========================================================
// Calculate partial typed-answer score
// =========================================================

function calculatePartialScore(typedAnswer, correctAnswer) {
  const typedWords = normaliseAnswer(typedAnswer);
  const correctWords = normaliseAnswer(correctAnswer);

  if (typedWords.length === 0 || correctWords.length === 0) {
    return 0;
  }

  if (typedWords.join(' ') === correctWords.join(' ')) {
    return 1;
  }

  const maxWords = correctWords.length;
  let matchedWords = 0;
  const usedCorrectIndexes = new Set();

  for (let i = 0; i < typedWords.length; i += 1) {
    if (i < correctWords.length && typedWords[i] === correctWords[i]) {
      matchedWords += 1;
      usedCorrectIndexes.add(i);
    }
  }

  for (let i = 0; i < typedWords.length; i += 1) {
    if (i < correctWords.length && usedCorrectIndexes.has(i)) {
      continue;
    }

    const correctIndex = correctWords.findIndex(
      (word, index) => word === typedWords[i] && !usedCorrectIndexes.has(index),
    );

    if (correctIndex !== -1) {
      matchedWords += 1;
      usedCorrectIndexes.add(correctIndex);
    }
  }

  return Math.min(matchedWords / maxWords, 1);
}

// =========================================================
// Format partial score
// =========================================================

function formatPoints(points) {
  if (points === 1) {
    return '1';
  }

  if (points === 0) {
    return '0';
  }

  return Number(points.toFixed(2)).toString();
}

// =========================================================
// Feedback
// =========================================================

function setFeedback(type, resultText, detailText = '', answerText = '') {
  feedbackElement.replaceChildren();

  feedbackElement.classList.remove(
    'correct-feedback',
    'partial-feedback',
    'incorrect-feedback',
  );

  if (type) {
    feedbackElement.classList.add(`${type}-feedback`);
  }

  const result = document.createElement('span');

  result.className = 'feedback-result';
  result.textContent = resultText;

  feedbackElement.appendChild(result);

  if (detailText) {
    const detail = document.createElement('span');

    detail.className = 'feedback-detail';
    detail.textContent = detailText;

    feedbackElement.appendChild(detail);
  }

  if (answerText) {
    const answer = document.createElement('span');

    answer.className = 'feedback-answer';
    answer.textContent = answerText;

    feedbackElement.appendChild(answer);
  }
}

// =========================================================
// Answer typed question
// =========================================================

function submitTypedAnswer() {
  if (answered) {
    return;
  }

  if (!currentAircraft) {
    return;
  }

  const typedAnswer = typeAnswerInput.value;

  /*
    Used for scoring.

    Aircraft name:
      Boeing 737-700

    ICAO:
      B737
  */

  const correctAnswer = getAnswerValue(currentAircraft, currentQuestionType);

  /*
    Used only for feedback.

    Aircraft name:
      Boeing 737-700 (B737)

    ICAO:
      B737
  */

  const feedbackAnswer = getFeedbackAnswer(
    currentAircraft,
    currentQuestionType,
  );

  const points = calculatePartialScore(typedAnswer, correctAnswer);

  answered = true;
  total += 1;

  score = Math.round((score + points) * 100) / 100;

  typeAnswerInput.classList.remove('correct', 'partial', 'incorrect');

  typeAnswerContainer.classList.remove('correct', 'partial', 'incorrect');

  if (points === 1) {
    typeAnswerInput.classList.add('correct');
    typeAnswerContainer.classList.add('correct');

    // FULL ANSWER SHOWN EVEN WHEN CORRECT
    setFeedback('correct', '✓ Correct!', 'Answer:', feedbackAnswer);
  } else if (points > 0) {
    typeAnswerInput.classList.add('partial');
    typeAnswerContainer.classList.add('partial');

    setFeedback(
      'partial',
      `◐ Partial · ${formatPointsWithGrammar(points)}`,
      'Correct answer:',
      feedbackAnswer,
    );
  } else {
    typeAnswerInput.classList.add('incorrect');
    typeAnswerContainer.classList.add('incorrect');

    setFeedback('incorrect', '✕ Incorrect', 'Correct answer:', feedbackAnswer);
  }

  typeAnswerInput.disabled = true;
  submitAnswerButton.disabled = true;

  updateScore();

  nextButton.disabled = false;
  nextButton.focus();
}

// =========================================================
// Answer multiple-choice question
// =========================================================

function answerMultipleChoice(button) {
  if (answered) {
    return;
  }

  if (!currentAircraft) {
    return;
  }

  const selectedAnswer = button.dataset.answer;

  /*
    Used for matching/scoring only.
  */

  const correctAnswer = getAnswerValue(currentAircraft, currentQuestionType);

  /*
    Used for displayed feedback.
  */

  const feedbackAnswer = getFeedbackAnswer(
    currentAircraft,
    currentQuestionType,
  );

  const isCorrect = selectedAnswer === correctAnswer;

  answered = true;
  total += 1;

  feedbackElement.classList.remove(
    'correct-feedback',
    'partial-feedback',
    'incorrect-feedback',
  );

  if (isCorrect) {
    score += 1;

    button.classList.add('correct');

    // FULL ANSWER SHOWN EVEN WHEN CORRECT
    setFeedback('correct', '✓ Correct!', 'Answer:', feedbackAnswer);
  } else {
    button.classList.add('incorrect');

    setFeedback('incorrect', '✕ Incorrect', 'Correct answer:', feedbackAnswer);

    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.answer === correctAnswer) {
        answerButton.classList.add('correct');
      }
    });
  }

  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;
  });

  updateScore();

  nextButton.disabled = false;
  nextButton.focus();
}

// =========================================================
// Answer reverse photo question
// =========================================================

function answerReversePhoto(button) {
  if (answered) {
    return;
  }

  if (!currentAircraft) {
    return;
  }

  const isCorrect = button.dataset.correct === 'true';

  /*
    Used for displayed feedback.

    For aircraft names this includes the ICAO.
  */

  const feedbackAnswer = getFeedbackAnswer(
    currentAircraft,
    currentQuestionType,
  );

  answered = true;
  total += 1;

  /*
    Reveal ALL 4 names after selection.
  */

  answerButtons.forEach((answerButton) => {
    const nameElement = answerButton.querySelector('.photo-choice-name');

    if (nameElement) {
      nameElement.classList.remove('hidden-name');
    }
  });

  void answerContainer.offsetHeight;

  if (isCorrect) {
    score += 1;

    button.classList.add('correct');

    // FULL ANSWER SHOWN EVEN WHEN CORRECT
    setFeedback('correct', '✓ Correct!', 'Answer:', feedbackAnswer);
  } else {
    button.classList.add('incorrect');

    setFeedback('incorrect', '✕ Incorrect', 'Correct answer:', feedbackAnswer);

    /*
      Mark the correct photo as well.
    */

    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true') {
        answerButton.classList.add('correct');
      }
    });
  }

  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;
  });

  updateScore();

  nextButton.disabled = false;

  requestAnimationFrame(() => {
    nextButton.focus();
  });
}

// =========================================================
// Answer button dispatcher
// =========================================================

function answerQuestion(button) {
  if (answerModeSelect.value === 'reverse') {
    answerReversePhoto(button);
    return;
  }

  answerMultipleChoice(button);
}

// =========================================================
// Configure answer mode
// =========================================================

function configureAnswerMode() {
  const answerMode = answerModeSelect.value;

  appElement.classList.remove('reverse-mode');

  if (answerMode === 'type') {
    answerContainer.hidden = true;
    typeAnswerContainer.hidden = false;
    imageContainer.hidden = false;
    return;
  }

  typeAnswerContainer.hidden = true;
  answerContainer.hidden = false;

  if (answerMode === 'reverse') {
    imageContainer.hidden = true;
    appElement.classList.add('reverse-mode');
    return;
  }

  imageContainer.hidden = false;
}

// =========================================================
// Focus helpers
// =========================================================

function getAvailableAnswerButtons() {
  return answerButtons.filter(
    (button) =>
      !button.disabled && !button.hidden && button.offsetParent !== null,
  );
}

function focusFirstAnswer() {
  const buttons = getAvailableAnswerButtons();

  if (buttons.length > 0) {
    buttons[0].focus();
  }
}

function focusLastAnswer() {
  const buttons = getAvailableAnswerButtons();

  if (buttons.length > 0) {
    buttons[buttons.length - 1].focus();
  }
}

// =========================================================
// Spatial keyboard navigation
// =========================================================

function moveAnswerFocus(direction) {
  const buttons = getAvailableAnswerButtons();

  const currentIndex = buttons.indexOf(document.activeElement);

  if (currentIndex === -1) {
    return false;
  }

  const currentButton = buttons[currentIndex];
  const currentRect = currentButton.getBoundingClientRect();

  const currentX = currentRect.left + currentRect.width / 2;

  const currentY = currentRect.top + currentRect.height / 2;

  let bestButton = null;
  let bestScore = Infinity;

  buttons.forEach((button) => {
    if (button === currentButton) {
      return;
    }

    const rect = button.getBoundingClientRect();

    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const dx = x - currentX;
    const dy = y - currentY;

    let primaryDistance;
    let secondaryDistance;

    if (direction === 'left' || direction === 'right') {
      if (direction === 'left' && dx >= -1) {
        return;
      }

      if (direction === 'right' && dx <= 1) {
        return;
      }

      primaryDistance = Math.abs(dx);
      secondaryDistance = Math.abs(dy);
    } else {
      if (direction === 'up' && dy >= -1) {
        return;
      }

      if (direction === 'down' && dy <= 1) {
        return;
      }

      primaryDistance = Math.abs(dy);
      secondaryDistance = Math.abs(dx);
    }

    const candidateScore = primaryDistance * 1000 + secondaryDistance;

    if (candidateScore < bestScore) {
      bestScore = candidateScore;
      bestButton = button;
    }
  });

  if (bestButton) {
    bestButton.focus();
    return true;
  }

  return false;
}

// =========================================================
// Detect editable / form-control targets
// =========================================================

function isTypingTarget(target) {
  if (!target) {
    return false;
  }

  const element = target instanceof Element ? target : null;

  if (!element) {
    return false;
  }

  return element.matches('input, textarea, select, [contenteditable="true"]');
}

function isNativeInteractiveTarget(target) {
  if (!target) {
    return false;
  }

  const element = target instanceof Element ? target : null;

  if (!element) {
    return false;
  }

  return element.matches(
    'input, textarea, select, button, a, [contenteditable="true"]',
  );
}

// =========================================================
// Load next question
// =========================================================

function nextQuestion() {
  answered = false;
  currentChoices = [];

  feedbackElement.textContent = '';

  nextButton.disabled = true;

  resetAnswerUI();
  configureAnswerMode();
  setLoading(true);

  const nextAircraft = chooseAircraft();

  if (!nextAircraft) {
    setLoading(false);

    promptElement.textContent = 'Not enough aircraft available.';

    answerButtons.forEach((button) => {
      button.disabled = true;
    });

    typeAnswerInput.disabled = true;
    submitAnswerButton.disabled = true;

    return;
  }

  currentAircraft = nextAircraft;
  currentQuestionType = chooseQuestionType();

  displayQuestion();

  const answerMode = answerModeSelect.value;

  // -------------------------------------------------------
  // Reverse photo mode
  // -------------------------------------------------------

  if (answerMode === 'reverse') {
    const choices = buildPhotoChoices(currentAircraft);

    currentChoices = choices;

    setLoading(false);

    displayPhotoAnswerChoices(choices);
    focusFirstAnswer();

    return;
  }

  // -------------------------------------------------------
  // Type answer mode
  // -------------------------------------------------------

  if (answerMode === 'type') {
    imageContainer.hidden = false;

    const imagePath = getRandomImagePath(currentAircraft);

    if (!imagePath) {
      setLoading(false);
      feedbackElement.textContent = 'Image unavailable.';
      return;
    }

    imageElement.onload = () => {
      setLoading(false);

      typeAnswerInput.disabled = false;
      submitAnswerButton.disabled = false;

      typeAnswerInput.focus();
    };

    imageElement.onerror = () => {
      setLoading(false);

      feedbackElement.textContent = 'Unable to load aircraft image.';

      typeAnswerInput.disabled = true;
      submitAnswerButton.disabled = true;
    };

    imageElement.src = imagePath;
    imageElement.alt = 'Aircraft recognition question image';

    return;
  }

  // -------------------------------------------------------
  // Multiple choice mode
  // -------------------------------------------------------

  const choices = buildTextAnswerChoices(currentAircraft, currentQuestionType);

  currentChoices = choices;

  displayTextAnswerChoices(choices);

  const imagePath = getRandomImagePath(currentAircraft);

  if (!imagePath) {
    setLoading(false);

    feedbackElement.textContent = 'Image unavailable.';

    answerButtons.forEach((button) => {
      button.disabled = true;
    });

    return;
  }

  imageElement.onload = () => {
    setLoading(false);

    answerButtons.forEach((button) => {
      if (!button.hidden) {
        button.disabled = false;
      }
    });

    focusFirstAnswer();
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
    (item) =>
      item &&
      typeof item === 'object' &&
      displayText(item.label) &&
      displayText(item.folder) &&
      getAircraftImages(item).length > 0,
  );

  if (aircraft.length === 0) {
    throw new Error('Manifest contains no usable aircraft.');
  }

  imageBags.clear();
}

// =========================================================
// Event listeners
// =========================================================

answerButtons.forEach((button) => {
  button.addEventListener('click', () => {
    answerQuestion(button);
  });
});

submitAnswerButton.addEventListener('click', () => {
  submitTypedAnswer();
});

typeAnswerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !submitAnswerButton.disabled) {
    event.preventDefault();
    submitTypedAnswer();
  }
});

nextButton.addEventListener('click', () => {
  if (!nextButton.disabled) {
    nextQuestion();
  }
});

categorySelect.addEventListener('change', () => {
  aircraftQueue = [];
  nextQuestion();
});

modeSelect.addEventListener('change', () => {
  aircraftQueue = [];
  nextQuestion();
});

answerModeSelect.addEventListener('change', () => {
  aircraftQueue = [];
  nextQuestion();
});

// =========================================================
// Keyboard controls
// =========================================================

document.addEventListener('keydown', (event) => {
  const typingTarget = isTypingTarget(event.target);

  // -----------------------------------------------------
  // Typed answer mode
  // -----------------------------------------------------

  if (typingTarget) {
    return;
  }

  // -----------------------------------------------------
  // Ignore modified shortcuts
  // -----------------------------------------------------

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  // -----------------------------------------------------
  // Next shortcut
  // -----------------------------------------------------

  if (
    event.key.toLowerCase() === 'n' &&
    !nextButton.disabled &&
    !isNativeInteractiveTarget(event.target)
  ) {
    event.preventDefault();
    nextQuestion();
    return;
  }

  // -----------------------------------------------------
  // Enter / Space after answering
  // -----------------------------------------------------

  if (answered && (event.key === 'Enter' || event.key === ' ')) {
    if (!isNativeInteractiveTarget(event.target)) {
      event.preventDefault();
      nextQuestion();
    }

    return;
  }

  // -----------------------------------------------------
  // Number shortcuts: 1–4
  // -----------------------------------------------------

  if (
    !answered &&
    (answerModeSelect.value === 'multiple-choice' ||
      answerModeSelect.value === 'reverse')
  ) {
    const key = event.key;

    if (key >= '1' && key <= '4') {
      const index = Number(key) - 1;
      const button = answerButtons[index];

      if (button && !button.disabled && !button.hidden) {
        event.preventDefault();

        button.focus();
        button.click();
      }

      return;
    }
  }

  // -----------------------------------------------------
  // Answer navigation
  // -----------------------------------------------------

  if (
    !answered &&
    (answerModeSelect.value === 'multiple-choice' ||
      answerModeSelect.value === 'reverse')
  ) {
    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown'
    ) {
      const moved = moveAnswerFocus(
        event.key.replace('Arrow', '').toLowerCase(),
      );

      if (moved) {
        event.preventDefault();
      }

      return;
    }

    // ---------------------------------------------------
    // Home / End
    // ---------------------------------------------------

    if (event.key === 'Home') {
      const buttons = getAvailableAnswerButtons();

      if (buttons.length > 0) {
        event.preventDefault();
        focusFirstAnswer();
      }

      return;
    }

    if (event.key === 'End') {
      const buttons = getAvailableAnswerButtons();

      if (buttons.length > 0) {
        event.preventDefault();
        focusLastAnswer();
      }

      return;
    }
  }
});

// =========================================================
// Prevent dragging / accidental native image interaction
// =========================================================

imageElement.addEventListener('dragstart', (event) => {
  event.preventDefault();
});

// =========================================================
// Startup
// =========================================================

async function start() {
  try {
    setupAccessibility();
    setLoading(true);

    await loadManifest();

    populateCategories();
    updateScore();
    nextQuestion();
  } catch (error) {
    console.error(error);

    setLoading(false);

    promptElement.textContent = 'Unable to load aircraft data.';

    feedbackElement.textContent =
      error instanceof Error ? error.message : String(error);

    answerButtons.forEach((button) => {
      button.disabled = true;
    });

    typeAnswerInput.disabled = true;
    submitAnswerButton.disabled = true;
    nextButton.disabled = true;

    promptElement.focus();
  }
}

start();
