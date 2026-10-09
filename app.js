const MANIFEST_PATH = 'manifest.json';
const ASSET_FOLDER = '';

// ============================================================
// DOM
// ============================================================

const $ = (selector) => document.querySelector(selector);
const byId = (id) => document.getElementById(id);

const appElement = $('.app');
const categorySelect = byId('category');
const questionTypeSelect = byId('question-type');
const answerTypeSelect = byId('answer-type');

const imageContainer = byId('image-container');
const imageElement = byId('aircraft-image');
const loadingMessage = byId('loading-message');
const promptElement = byId('prompt');

const answerContainer = byId('answers');
const answerButtons = [...document.querySelectorAll('#answers button')];

const typeAnswerContainer = byId('type-answer-container');
const typeAnswerInput = byId('type-answer-input');
const submitAnswerButton = byId('submit-answer');

const scoreElement = byId('score');
const feedbackElement = byId('feedback');
const nextButton = byId('next');

// ============================================================
// Configuration
// ============================================================

const ANSWER_MODES = [
  { value: 'name', label: 'Choose name', semantic: 'name' },
  { value: 'icao', label: 'Choose ICAO', semantic: 'icao' },
  { value: 'photo', label: 'Choose photo', semantic: 'photo' },
  { value: 'enter-name', label: 'Type name', semantic: 'name' },
  { value: 'enter-icao', label: 'Type ICAO', semantic: 'icao' },
];

const QUESTION_TYPES = new Set(['photo', 'name', 'icao']);

const KEYBOARD_HELP =
  'Keyboard shortcuts: 1 through 4 select an answer. ' +
  'Arrow keys move between answer choices. ' +
  'Home selects the first answer and End selects the last. ' +
  'Enter submits a typed answer. N moves to the next question.';

// ============================================================
// State
// ============================================================

let aircraft = [];
let currentAircraft = null;
let currentChoices = [];
let aircraftQueue = [];

let score = 0;
let total = 0;
let answered = false;

// ============================================================
// General utilities
// ============================================================

function displayText(value) {
  return value == null ? '' : String(value).trim();
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

function randomItem(items) {
  return items.length ? items[Math.floor(Math.random() * items.length)] : null;
}

function uniqueBy(items, getKey) {
  const seen = new Set();

  return items.filter((item) => {
    const key = getKey(item);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

// ============================================================
// Modes
// ============================================================

function getQuestionType() {
  return questionTypeSelect.value;
}

function getAnswerMode() {
  return answerTypeSelect.value;
}

function getAnswerSemanticType(mode = getAnswerMode()) {
  return ANSWER_MODES.find((item) => item.value === mode)?.semantic ?? '';
}

function isTypedAnswer(mode = getAnswerMode()) {
  return mode === 'enter-name' || mode === 'enter-icao';
}

function isPhotoAnswer(mode = getAnswerMode()) {
  return mode === 'photo';
}

function getTypedAnswerType(mode = getAnswerMode()) {
  if (mode === 'enter-name') return 'Aircraft name';
  if (mode === 'enter-icao') return 'ICAO code';
  return '';
}

function ensureAnswerTypeOptions() {
  for (const definition of ANSWER_MODES) {
    let option = [...answerTypeSelect.options].find(
      (item) => item.value === definition.value,
    );

    if (!option) {
      option = document.createElement('option');
      option.value = definition.value;
      answerTypeSelect.appendChild(option);
    }

    option.textContent = definition.label;
  }
}

function syncAnswerOptions() {
  const questionType = getQuestionType();

  for (const option of answerTypeSelect.options) {
    const invalid = getAnswerSemanticType(option.value) === questionType;

    option.disabled = invalid;
    option.hidden = invalid;
  }

  const selectedOption =
    answerTypeSelect.options[answerTypeSelect.selectedIndex];

  if (selectedOption && !selectedOption.disabled) {
    return;
  }

  const preferredModes = {
    photo: ['name', 'enter-name', 'icao', 'enter-icao'],
    name: ['photo', 'icao', 'enter-icao'],
    icao: ['photo', 'name', 'enter-name'],
  };

  for (const mode of preferredModes[questionType] ?? []) {
    const option = [...answerTypeSelect.options].find(
      (item) => item.value === mode && !item.disabled,
    );

    if (option) {
      answerTypeSelect.value = mode;
      return;
    }
  }

  const firstAvailable = [...answerTypeSelect.options].find(
    (option) => !option.disabled,
  );

  if (firstAvailable) {
    answerTypeSelect.value = firstAvailable.value;
  }
}

// ============================================================
// Aircraft data helpers
// ============================================================

function getAnswerValue(item, type) {
  if (!item) return '';

  if (type === 'Aircraft name' || type === 'name') {
    const name = displayText(item.label ?? item.name);

    // "Cessna 150 (C150)" becomes "Cessna 150".
    return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  if (type === 'ICAO code' || type === 'icao') {
    return displayText(
      item.code ?? item.icao ?? item.icao_code ?? item.ICAO ?? item.icaoCode,
    );
  }

  return '';
}

function getFeedbackAnswer(item, type) {
  if (!item) return '';

  const name = getAnswerValue(item, 'Aircraft name');
  const code = getAnswerValue(item, 'ICAO code');

  if (type === 'Aircraft name' || type === 'name') {
    return name && code ? `${name} (${code})` : name || code;
  }

  if (type === 'ICAO code' || type === 'icao') {
    return code && name ? `${code} (${name})` : code || name;
  }

  return '';
}

function getFeedbackDisplayAnswer(item) {
  if (!item) return '';

  const questionType = getQuestionType();
  const answerMode = getAnswerMode();
  const answerSemantic = getAnswerSemanticType(answerMode);

  const name = getAnswerValue(item, 'Aircraft name');
  const code = getAnswerValue(item, 'ICAO code');

  // Photo questions: put the requested identifier first.
  if (questionType === 'photo') {
    return answerSemantic === 'icao'
      ? getFeedbackAnswer(item, 'icao')
      : getFeedbackAnswer(item, 'name');
  }

  // Aircraft name questions: ICAO code alone, or name plus code
  // when the answer is a photo.
  if (questionType === 'name') {
    if (answerSemantic === 'icao') return code;
    if (answerSemantic === 'photo') {
      return name && code ? `${name} (${code})` : name || code;
    }
  }

  // ICAO questions: show the aircraft name and code together
  // when answering with a name, or code first when answering with a photo.
  if (questionType === 'icao') {
    if (answerSemantic === 'name') {
      return name;
    }
    if (answerSemantic === 'photo') {
      return code && name ? `${code} (${name})` : code || name;
    }
  }

  return getFeedbackAnswer(item, answerSemantic === 'icao' ? 'icao' : 'name');
}

function getTypedAnswerValue(item, mode = getAnswerMode()) {
  if (mode === 'enter-name') {
    return getAnswerValue(item, 'Aircraft name');
  }

  if (mode === 'enter-icao') {
    return getAnswerValue(item, 'ICAO code');
  }

  return '';
}

function getAircraftTypeKey(item) {
  const code = displayText(
    item?.code ?? item?.icao ?? item?.icao_code ?? item?.ICAO ?? item?.icaoCode,
  ).toLowerCase();

  const name = displayText(item?.name ?? item?.label)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .toLowerCase();

  if (code) return `code:${code}`;
  if (name) return `name:${name}`;

  return '';
}

// ============================================================
// Image paths
//
// Manifest example:
// {
//   "folder": "Cessna 150",
//   "images": ["001.jpg", "002.jpg"]
// }
//
// With ASSET_FOLDER = '', the resulting path is:
// Cessna 150/001.jpg
// ============================================================

function cleanPath(value) {
  return displayText(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function getAircraftImages(item) {
  if (!item) return [];

  const folder = cleanPath(item.folder);
  const baseFolder = cleanPath(ASSET_FOLDER);

  let images = [];

  if (Array.isArray(item.images)) {
    images = item.images.map(cleanPath).filter(Boolean);
  } else if (item.image_path) {
    images = [cleanPath(item.image_path)].filter(Boolean);
  }

  return images.map((image) => {
    const path = folder ? `${folder}/${image}` : image;
    return baseFolder ? `${baseFolder}/${path}` : path;
  });
}

function getRandomImagePath(item) {
  return randomItem(getAircraftImages(item)) ?? '';
}

// ============================================================
// Categories and aircraft pool
// ============================================================

function populateCategories() {
  const categories = [
    ...new Set(
      aircraft.map((item) => displayText(item.category)).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));

  categorySelect.replaceChildren();

  const allOption = document.createElement('option');
  allOption.value = 'All';
  allOption.textContent = 'All';
  categorySelect.appendChild(allOption);

  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  }
}

function getSelectedAircraftPool() {
  const category = categorySelect.value;

  if (!category || category === 'All') {
    return [...aircraft];
  }

  return aircraft.filter((item) => displayText(item.category) === category);
}

function itemHasRequiredValue(item, type) {
  if (type === 'photo') {
    return getAircraftImages(item).length > 0;
  }

  return Boolean(getAnswerValue(item, type));
}

function filterPoolForCombination(pool) {
  const questionType = getQuestionType();
  const answerSemantic = getAnswerSemanticType();

  return pool.filter((item) => {
    if (!itemHasRequiredValue(item, questionType)) return false;

    if (answerSemantic === 'photo') {
      return getAircraftImages(item).length > 0;
    }

    return Boolean(getAnswerValue(item, answerSemantic));
  });
}

function hasEnoughDistinctAnswers(pool) {
  if (isTypedAnswer()) return pool.length > 0;

  if (isPhotoAnswer()) {
    return uniqueBy(pool, getAircraftTypeKey).length >= 4;
  }

  const answerType = getAnswerSemanticType();

  return (
    uniqueBy(pool, (item) => getAnswerValue(item, answerType).toLowerCase())
      .length >= 4
  );
}

function getValidAircraftPool() {
  const selectedPool = filterPoolForCombination(getSelectedAircraftPool());

  if (isTypedAnswer()) {
    return selectedPool;
  }

  if (hasEnoughDistinctAnswers(selectedPool)) {
    return selectedPool;
  }

  // If a category is too small for four distinct choices,
  // use the full dataset instead.
  const fullPool = filterPoolForCombination(aircraft);

  return fullPool;
}

// ============================================================
// Question rotation
//
// Each aircraft type appears once per cycle.
// ============================================================

function chooseAircraft() {
  const pool = getValidAircraftPool();

  if (!pool.length) return null;

  const aircraftByType = new Map();

  for (const item of pool) {
    const key = getAircraftTypeKey(item);

    if (!key) continue;

    if (!aircraftByType.has(key)) {
      aircraftByType.set(key, []);
    }

    aircraftByType.get(key).push(item);
  }

  if (!aircraftByType.size) return null;

  const availableKeys = new Set(aircraftByType.keys());

  aircraftQueue = aircraftQueue.filter((item) =>
    availableKeys.has(getAircraftTypeKey(item)),
  );

  if (!aircraftQueue.length) {
    aircraftQueue = shuffle(
      [...aircraftByType.values()].map((entries) => entries[0]),
    );
  }

  const representative = aircraftQueue.pop();
  const entries = aircraftByType.get(getAircraftTypeKey(representative));

  return randomItem(entries) ?? representative;
}

// ============================================================
// Build multiple-choice answers
// ============================================================

function buildTextAnswerChoices(correctAircraft, answerType) {
  const correctAnswer = getAnswerValue(correctAircraft, answerType);

  const usableAircraft = getValidAircraftPool().filter((item) =>
    getAnswerValue(item, answerType),
  );

  const uniqueAircraft = uniqueBy(usableAircraft, (item) =>
    getAnswerValue(item, answerType).toLowerCase(),
  );

  // Prefer distractors from the same category.
  const sameCategory = uniqueAircraft.filter(
    (item) =>
      item !== correctAircraft &&
      displayText(item.category) === displayText(correctAircraft.category),
  );

  const otherCategories = uniqueAircraft.filter(
    (item) =>
      item !== correctAircraft &&
      displayText(item.category) !== displayText(correctAircraft.category),
  );

  shuffle(sameCategory);
  shuffle(otherCategories);

  const distractors = [...sameCategory, ...otherCategories].slice(0, 3);

  const choices = shuffle([
    { aircraft: correctAircraft, text: correctAnswer },
    ...distractors.map((item) => ({
      aircraft: item,
      text: getAnswerValue(item, answerType),
    })),
  ]);

  return choices;
}

function buildPhotoChoices(correctAircraft) {
  const correctKey = getAircraftTypeKey(correctAircraft);
  const category = displayText(correctAircraft.category);

  const available = uniqueBy(
    aircraft.filter(
      (item) =>
        getAircraftImages(item).length > 0 &&
        getAnswerValue(item, 'Aircraft name'),
    ),
    getAircraftTypeKey,
  ).filter((item) => getAircraftTypeKey(item) !== correctKey);

  const sameCategory = available.filter(
    (item) => displayText(item.category) === category,
  );

  const otherCategories = available.filter(
    (item) => displayText(item.category) !== category,
  );

  shuffle(sameCategory);
  shuffle(otherCategories);

  const distractors = [...sameCategory, ...otherCategories].slice(0, 3);

  return shuffle([correctAircraft, ...distractors]).map((item) => ({
    aircraft: item,
    text: getFeedbackDisplayAnswer(item),
  }));
}

// ============================================================
// Question wording
// ============================================================

function getIndefiniteArticle(value) {
  return /^[aeiou]/i.test(displayText(value)) ? 'an' : 'a';
}

function displayQuestion() {
  promptElement.replaceChildren();

  const questionType = getQuestionType();
  const answerMode = getAnswerMode();

  const name = getAnswerValue(currentAircraft, 'Aircraft name');
  const code = getAnswerValue(currentAircraft, 'ICAO code');

  let text = '';

  if (questionType === 'photo') {
    text =
      getAnswerSemanticType(answerMode) === 'icao'
        ? 'What is the ICAO code?'
        : 'Which aircraft is this?';
  } else if (questionType === 'name') {
    if (answerMode === 'photo') {
      text = `Which photo is ${getIndefiniteArticle(name)} ${name}?`;
    } else {
      text = `What is the ICAO code for ${getIndefiniteArticle(name)} ${name}?`;
    }
  } else if (questionType === 'icao') {
    if (answerMode === 'photo') {
      text = `Which photo is ${code}?`;
    } else {
      text = `Which aircraft has ICAO code ${code}?`;
    }
  }

  promptElement.appendChild(document.createTextNode(text));

  const category = displayText(currentAircraft?.category);

  if (category) {
    const hint = document.createElement('span');
    hint.className = 'category-hint';
    hint.textContent = category;
    hint.setAttribute('aria-label', `Category: ${category}`);
    promptElement.appendChild(hint);
  }
}

// ============================================================
// UI state
// ============================================================

function setLoading(loading) {
  imageElement.classList.toggle('loading', loading);
  loadingMessage.classList.toggle('hidden', !loading);

  if (loading) {
    answerButtons.forEach((button) => {
      button.disabled = true;
    });

    typeAnswerInput.disabled = true;
    submitAnswerButton.disabled = true;
    nextButton.disabled = true;
  }
}

function resetAnswerUI() {
  answerButtons.forEach((button, index) => {
    button.disabled = true;
    button.hidden = false;
    button.classList.remove('correct', 'incorrect');
    button.replaceChildren();

    delete button.dataset.answer;
    delete button.dataset.correct;

    button.removeAttribute('aria-hidden');
    button.setAttribute('aria-label', `Answer option ${index + 1}`);
  });

  answerContainer.classList.remove('reverse');
  answerContainer.hidden = false;

  typeAnswerContainer.hidden = true;
  typeAnswerContainer.classList.remove('correct', 'partial', 'incorrect');

  typeAnswerInput.value = '';
  typeAnswerInput.disabled = true;
  typeAnswerInput.classList.remove('correct', 'partial', 'incorrect');

  submitAnswerButton.disabled = true;

  feedbackElement.replaceChildren();
  feedbackElement.classList.remove(
    'correct-feedback',
    'partial-feedback',
    'incorrect-feedback',
  );

  imageContainer.hidden = false;
}

function updateScore() {
  const percentage = total ? Math.round((score / total) * 100) : 0;
  scoreElement.textContent = `Score: ${score}/${total} (${percentage}%)`;
}

// ============================================================
// Feedback
// ============================================================

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

function revealCorrectPhotoNames() {
  answerButtons.forEach((button) => {
    button.querySelector('.photo-choice-name')?.classList.remove('hidden-name');
  });
}

function finishAnswer() {
  updateScore();
  nextButton.disabled = false;
  nextButton.focus();
}

// ============================================================
// Display text choices
// ============================================================

function displayTextAnswerChoices(choices, disabled = false) {
  answerContainer.classList.remove('reverse');
  answerContainer.hidden = false;

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
    button.textContent = choice.text;

    button.dataset.answer = choice.text;
    button.dataset.correct =
      choice.aircraft === currentAircraft ? 'true' : 'false';

    button.disabled = disabled;
    button.setAttribute('aria-label', `Option ${index + 1}: ${choice.text}`);
    button.setAttribute('aria-keyshortcuts', String(index + 1));
  });
}

// ============================================================
// Display photo choices
// ============================================================

function displayPhotoAnswerChoices(choices) {
  answerContainer.classList.add('reverse');
  answerContainer.hidden = false;

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

    const image = document.createElement('img');
    image.src = getRandomImagePath(choice.aircraft);
    image.alt = `Aircraft photo option ${index + 1}`;
    image.draggable = false;

    const name = document.createElement('span');
    name.className = 'photo-choice-name hidden-name';
    name.textContent = choice.text;

    button.append(image, name);

    button.dataset.answer = choice.text;
    button.dataset.correct =
      choice.aircraft === currentAircraft ? 'true' : 'false';

    button.disabled = false;
    button.setAttribute('aria-label', `Photo option ${index + 1}`);
    button.setAttribute('aria-keyshortcuts', String(index + 1));
  });
}

// ============================================================
// Typed-answer normalisation and scoring
// ============================================================

function normaliseAnswer(value) {
  return displayText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function calculatePartialScore(typedAnswer, correctAnswer) {
  const typedWords = normaliseAnswer(typedAnswer);
  const correctWords = normaliseAnswer(correctAnswer);

  if (!typedWords.length || !correctWords.length) return 0;

  if (typedWords.join(' ') === correctWords.join(' ')) {
    return 1;
  }

  const matchedIndexes = new Set();
  let matchedWords = 0;

  // Match words in their original positions first.
  typedWords.forEach((word, index) => {
    if (index < correctWords.length && word === correctWords[index]) {
      matchedIndexes.add(index);
      matchedWords += 1;
    }
  });

  // Match remaining words regardless of position.
  for (const word of typedWords) {
    const index = correctWords.findIndex(
      (correctWord, correctIndex) =>
        correctWord === word && !matchedIndexes.has(correctIndex),
    );

    if (index !== -1) {
      matchedIndexes.add(index);
      matchedWords += 1;
    }
  }

  return Math.min(matchedWords / correctWords.length, 1);
}

function formatPoints(points) {
  if (points === 1) return '1';
  if (points === 0) return '0';

  return Number(points.toFixed(2)).toString();
}

function formatPointsWithGrammar(points) {
  const value = formatPoints(points);
  return value === '1' ? '1 point' : `${value} points`;
}

// ============================================================
// Submit typed answer
// ============================================================

function shouldHideFeedbackAnswer() {
  return false;
}

function submitTypedAnswer() {
  if (answered || !currentAircraft || !isTypedAnswer()) return;

  const answerMode = getAnswerMode();
  const correctAnswer = getTypedAnswerValue(currentAircraft, answerMode);

  if (!correctAnswer) return;

  const feedbackAnswer = getFeedbackDisplayAnswer(currentAircraft);
  const feedbackDetail = 'Correct answer:';
  const feedbackText = feedbackAnswer;

  const points = calculatePartialScore(typeAnswerInput.value, correctAnswer);

  answered = true;
  total += 1;
  score = Math.round((score + points) * 100) / 100;

  typeAnswerInput.classList.remove('correct', 'partial', 'incorrect');
  typeAnswerContainer.classList.remove('correct', 'partial', 'incorrect');

  if (points === 1) {
    typeAnswerInput.classList.add('correct');
    typeAnswerContainer.classList.add('correct');
    setFeedback('correct', '✓ Correct!', feedbackDetail, feedbackText);
  } else if (points > 0) {
    typeAnswerInput.classList.add('partial');
    typeAnswerContainer.classList.add('partial');
    setFeedback(
      'partial',
      `◐ Partial · ${formatPointsWithGrammar(points)}`,
      feedbackDetail,
      feedbackText,
    );
  } else {
    typeAnswerInput.classList.add('incorrect');
    typeAnswerContainer.classList.add('incorrect');
    setFeedback('incorrect', '✕ Incorrect', feedbackDetail, feedbackText);
  }

  typeAnswerInput.disabled = true;
  submitAnswerButton.disabled = true;

  finishAnswer();
}

// ============================================================
// Submit multiple-choice answer
// ============================================================

function answerMultipleChoice(button) {
  if (answered || !currentAircraft) return;

  const feedbackAnswer = getFeedbackDisplayAnswer(currentAircraft);
  const isCorrect = button.dataset.correct === 'true';

  answered = true;
  total += 1;

  if (isCorrect) {
    score += 1;
    button.classList.add('correct');
    setFeedback(
      'correct',
      '✓ Correct!',
      shouldHideFeedbackAnswer() ? '' : 'Answer:',
      shouldHideFeedbackAnswer() ? '' : feedbackAnswer,
    );
  } else {
    button.classList.add('incorrect');
    setFeedback(
      'incorrect',
      '✕ Incorrect',
      shouldHideFeedbackAnswer() ? '' : 'Correct answer:',
      shouldHideFeedbackAnswer() ? '' : feedbackAnswer,
    );
    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true') {
        answerButton.classList.add('correct');
      }
    });
  }

  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;
  });

  finishAnswer();
}

// ============================================================
// Submit reverse-photo answer
// ============================================================

function answerReversePhoto(button) {
  if (answered || !currentAircraft) return;

  const isCorrect = button.dataset.correct === 'true';
  const feedbackAnswer = getFeedbackDisplayAnswer(currentAircraft);

  answered = true;
  total += 1;

  revealCorrectPhotoNames();

  if (isCorrect) {
    score += 1;
    button.classList.add('correct');

    setFeedback('correct', '✓ Correct!', 'Answer:', feedbackAnswer);
  } else {
    button.classList.add('incorrect');

    setFeedback('incorrect', '✕ Incorrect', 'Correct photo:', feedbackAnswer);

    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true') {
        answerButton.classList.add('correct');
      }
    });
  }

  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;
  });

  finishAnswer();
}

function answerQuestion(button) {
  if (isTypedAnswer()) return;

  if (isPhotoAnswer()) {
    answerReversePhoto(button);
  } else {
    answerMultipleChoice(button);
  }
}

// ============================================================
// Configure layout for selected modes
// ============================================================

function configureAnswerMode() {
  const questionType = getQuestionType();
  const answerMode = getAnswerMode();

  appElement.classList.remove('reverse-mode', 'no-image');

  if (questionType === 'photo') {
    imageContainer.hidden = false;

    if (isTypedAnswer(answerMode)) {
      answerContainer.hidden = true;
      typeAnswerContainer.hidden = false;
    } else {
      answerContainer.hidden = false;
      typeAnswerContainer.hidden = true;
    }

    return;
  }

  if (isPhotoAnswer(answerMode)) {
    imageContainer.hidden = true;
    answerContainer.hidden = false;
    typeAnswerContainer.hidden = true;
    appElement.classList.add('reverse-mode');
    return;
  }

  if (isTypedAnswer(answerMode)) {
    imageContainer.hidden = true;
    answerContainer.hidden = true;
    typeAnswerContainer.hidden = false;
    appElement.classList.add('no-image');
    return;
  }

  imageContainer.hidden = true;
  answerContainer.hidden = false;
  typeAnswerContainer.hidden = true;
  appElement.classList.add('no-image');
}

// ============================================================
// Image loading
// ============================================================

function loadQuestionImage(path, altText) {
  return new Promise((resolve, reject) => {
    imageElement.onload = () => resolve();
    imageElement.onerror = () =>
      reject(new Error(`Unable to load aircraft image: ${path}`));

    imageElement.alt = altText;
    imageElement.src = path;
  });
}

// ============================================================
// Next question
// ============================================================

async function nextQuestion() {
  answered = false;
  currentChoices = [];
  currentAircraft = null;

  feedbackElement.replaceChildren();

  syncAnswerOptions();
  resetAnswerUI();
  configureAnswerMode();
  setLoading(true);

  const item = chooseAircraft();

  if (!item) {
    setLoading(false);
    promptElement.textContent = 'Not enough aircraft available.';
    feedbackElement.textContent =
      'Check that the manifest contains enough distinct aircraft for the selected modes.';
    return;
  }

  currentAircraft = item;

  const questionType = getQuestionType();
  const answerMode = getAnswerMode();
  const answerSemantic = getAnswerSemanticType(answerMode);

  // The value used to build text choices and display feedback.
  const answerType =
    answerSemantic === 'name'
      ? 'Aircraft name'
      : answerSemantic === 'icao'
        ? 'ICAO code'
        : questionType === 'name'
          ? 'Aircraft name'
          : 'ICAO code';

  displayQuestion();

  // Photo question: identify the displayed aircraft.
  if (questionType === 'photo') {
    const imagePath = getRandomImagePath(currentAircraft);

    if (!imagePath) {
      setLoading(false);
      feedbackElement.textContent = 'No image is available for this aircraft.';
      return;
    }

    if (isTypedAnswer(answerMode)) {
      try {
        await loadQuestionImage(
          imagePath,
          'Aircraft recognition question image',
        );
        setLoading(false);

        typeAnswerInput.disabled = false;
        submitAnswerButton.disabled = false;
        typeAnswerInput.focus();
      } catch (error) {
        setLoading(false);
        feedbackElement.textContent = error.message;
      }

      return;
    }

    currentChoices = buildTextAnswerChoices(currentAircraft, answerType);
    displayTextAnswerChoices(currentChoices, true);

    try {
      await loadQuestionImage(imagePath, 'Aircraft recognition question image');

      setLoading(false);
      answerButtons.forEach((button) => {
        if (!button.hidden) button.disabled = false;
      });

      focusFirstAnswer();
    } catch (error) {
      setLoading(false);
      feedbackElement.textContent = error.message;
      answerButtons.forEach((button) => {
        button.disabled = true;
      });
    }

    return;
  }

  // Text question: choose the correct aircraft photo.
  if (isPhotoAnswer(answerMode)) {
    currentChoices = buildPhotoChoices(currentAircraft);
    displayPhotoAnswerChoices(currentChoices);
    setLoading(false);

    answerButtons.forEach((button) => {
      if (!button.hidden) button.disabled = false;
    });

    focusFirstAnswer();
    return;
  }

  // Text question: type an answer.
  if (isTypedAnswer(answerMode)) {
    setLoading(false);
    typeAnswerInput.disabled = false;
    submitAnswerButton.disabled = false;
    typeAnswerInput.focus();
    return;
  }

  // Text question: choose a text answer.
  currentChoices = buildTextAnswerChoices(currentAircraft, answerType);
  displayTextAnswerChoices(currentChoices);

  setLoading(false);
  focusFirstAnswer();
}

// ============================================================
// Load manifest
// ============================================================

async function loadManifest() {
  const response = await fetch(MANIFEST_PATH);

  if (!response.ok) {
    throw new Error(`Unable to load manifest (${response.status}).`);
  }

  const manifest = await response.json();

  if (!manifest || !Array.isArray(manifest.aircraft)) {
    throw new Error('Invalid manifest: expected an aircraft array.');
  }

  aircraft = manifest.aircraft.filter((item) => {
    if (!item || typeof item !== 'object') return false;

    const hasFolder = Boolean(displayText(item.folder));
    const hasImages =
      (Array.isArray(item.images) && item.images.some(Boolean)) ||
      Boolean(displayText(item.image_path));

    return hasFolder && hasImages;
  });

  if (!aircraft.length) {
    throw new Error('Manifest contains no usable aircraft.');
  }

  console.info(`Loaded ${aircraft.length} aircraft from manifest.`);
}

// ============================================================
// Keyboard navigation
// ============================================================

function getAvailableAnswerButtons() {
  return answerButtons.filter(
    (button) =>
      !button.disabled && !button.hidden && button.offsetParent !== null,
  );
}

function focusFirstAnswer() {
  getAvailableAnswerButtons()[0]?.focus();
}

function focusLastAnswer() {
  const buttons = getAvailableAnswerButtons();
  buttons[buttons.length - 1]?.focus();
}

function moveAnswerFocus(direction) {
  const buttons = getAvailableAnswerButtons();
  const current = document.activeElement;
  const index = buttons.indexOf(current);

  if (index === -1) return false;

  const rect = current.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  let bestButton = null;
  let bestScore = Infinity;

  for (const button of buttons) {
    if (button === current) continue;

    const otherRect = button.getBoundingClientRect();
    const dx = otherRect.left + otherRect.width / 2 - x;
    const dy = otherRect.top + otherRect.height / 2 - y;

    let primary;
    let secondary;

    if (direction === 'left' || direction === 'right') {
      if (direction === 'left' && dx >= -1) continue;
      if (direction === 'right' && dx <= 1) continue;

      primary = Math.abs(dx);
      secondary = Math.abs(dy);
    } else {
      if (direction === 'up' && dy >= -1) continue;
      if (direction === 'down' && dy <= 1) continue;

      primary = Math.abs(dy);
      secondary = Math.abs(dx);
    }

    const candidateScore = primary * 1000 + secondary;

    if (candidateScore < bestScore) {
      bestScore = candidateScore;
      bestButton = button;
    }
  }

  if (!bestButton) return false;

  bestButton.focus();
  return true;
}

function isTypingTarget(target) {
  return (
    target instanceof Element &&
    target.matches('input, textarea, select, [contenteditable="true"]')
  );
}

function isNativeInteractiveTarget(target) {
  return (
    target instanceof Element &&
    target.matches(
      'input, textarea, select, button, a, [contenteditable="true"]',
    )
  );
}

function handleKeyboard(event) {
  if (isTypingTarget(event.target)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  const key = event.key.toLowerCase();

  if (
    key === 'n' &&
    !nextButton.disabled &&
    !isNativeInteractiveTarget(event.target)
  ) {
    event.preventDefault();
    nextQuestion();
    return;
  }

  if (answered && (event.key === 'Enter' || event.key === ' ')) {
    if (!isNativeInteractiveTarget(event.target)) {
      event.preventDefault();
      nextQuestion();
    }

    return;
  }

  if (!answered && /^[1-4]$/.test(event.key)) {
    const button = answerButtons[Number(event.key) - 1];

    if (button && !button.disabled && !button.hidden) {
      event.preventDefault();
      button.click();
    }

    return;
  }

  if (answered) return;

  const direction = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  }[event.key];

  if (direction && moveAnswerFocus(direction)) {
    event.preventDefault();
    return;
  }

  if (event.key === 'Home' && getAvailableAnswerButtons().length) {
    event.preventDefault();
    focusFirstAnswer();
  }

  if (event.key === 'End' && getAvailableAnswerButtons().length) {
    event.preventDefault();
    focusLastAnswer();
  }
}

// ============================================================
// Accessibility
// ============================================================

function setupAccessibility() {
  appElement.setAttribute('aria-describedby', 'keyboard-shortcuts-help');

  promptElement.setAttribute('aria-live', 'polite');
  promptElement.setAttribute('aria-atomic', 'true');
  promptElement.setAttribute('tabindex', '-1');

  feedbackElement.setAttribute('aria-live', 'polite');
  feedbackElement.setAttribute('aria-atomic', 'true');

  scoreElement.setAttribute('aria-live', 'polite');
  scoreElement.setAttribute('aria-atomic', 'true');

  loadingMessage.setAttribute('role', 'status');
  loadingMessage.setAttribute('aria-live', 'polite');
  loadingMessage.setAttribute('aria-atomic', 'true');

  answerContainer.setAttribute('aria-label', 'Answer choices');

  let help = byId('keyboard-shortcuts-help');

  if (!help) {
    help = document.createElement('div');
    help.id = 'keyboard-shortcuts-help';
    help.className = 'visually-hidden';
    help.textContent = KEYBOARD_HELP;
    document.body.appendChild(help);
  }

  answerButtons.forEach((button, index) => {
    button.setAttribute('aria-keyshortcuts', String(index + 1));
  });

  nextButton.setAttribute('aria-keyshortcuts', 'Enter Space N');
  submitAnswerButton.setAttribute('aria-keyshortcuts', 'Enter');
}

// ============================================================
// Event listeners
// ============================================================

answerButtons.forEach((button) => {
  button.addEventListener('click', () => answerQuestion(button));
});

submitAnswerButton.addEventListener('click', submitTypedAnswer);

typeAnswerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !submitAnswerButton.disabled) {
    event.preventDefault();
    submitTypedAnswer();
  }
});

nextButton.addEventListener('click', () => {
  if (!nextButton.disabled) nextQuestion();
});

categorySelect.addEventListener('change', () => {
  aircraftQueue = [];
  nextQuestion();
});

questionTypeSelect.addEventListener('change', () => {
  aircraftQueue = [];
  syncAnswerOptions();
  nextQuestion();
});

answerTypeSelect.addEventListener('change', () => {
  aircraftQueue = [];
  nextQuestion();
});

document.addEventListener('keydown', handleKeyboard);

imageElement.addEventListener('dragstart', (event) => {
  event.preventDefault();
});

// ============================================================
// Startup
// ============================================================

async function start() {
  try {
    ensureAnswerTypeOptions();
    setupAccessibility();
    setLoading(true);

    await loadManifest();

    populateCategories();
    syncAnswerOptions();
    updateScore();

    await nextQuestion();
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
