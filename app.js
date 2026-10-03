const MANIFEST_PATH = 'aircraft_quiz_assets/manifest.json';
const ASSET_FOLDER = 'aircraft_quiz_assets';

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
const streakElement = document.getElementById('streak');

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
let streak = 0;

let answered = false;

// =========================================================
// Accessibility setup
// =========================================================

function setupAccessibility() {
  /*
     Make dynamic regions understandable to screen readers.
  */

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

  if (streakElement) {
    streakElement.setAttribute('aria-live', 'polite');
    streakElement.setAttribute('aria-atomic', 'true');
  }

  if (loadingMessage) {
    loadingMessage.setAttribute('role', 'status');
    loadingMessage.setAttribute('aria-live', 'polite');
    loadingMessage.setAttribute('aria-atomic', 'true');
  }

  if (answerContainer) {
    answerContainer.setAttribute('aria-label', 'Answer choices');
  }

  /*
     Add a screen-reader-only keyboard shortcut guide
     without requiring an HTML change.
  */

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

  /*
     ARIA keyboard shortcut metadata.
  */

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

  // Use the first spoken-looking word.
  const firstWord = value
    .replace(/^[^A-Za-z0-9]+/, '')
    .split(/\s+/)[0]
    .toLowerCase();

  // Words that begin with a vowel sound.
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
// Image path
// =========================================================

function getImagePath(item) {
  const imagePath = displayText(item?.image_path);

  if (!imagePath) {
    return '';
  }

  return `${ASSET_FOLDER}/${imagePath
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/')}`;
}

// =========================================================
// Answer value
// =========================================================

function getAnswerValue(item, questionType) {
  if (questionType === 'Aircraft name') {
    return displayText(item?.name);
  }

  return displayText(item?.code);
}

// =========================================================
// Aircraft type identity
// =========================================================

function getAircraftTypeKey(item) {
  const code = displayText(item?.code).toLowerCase();
  const name = displayText(item?.name).toLowerCase();

  // ICAO code is the best identifier of the aircraft type.
  if (code) {
    return `code:${code}`;
  }

  // Fall back to aircraft name when no code exists.
  if (name) {
    return `name:${name}`;
  }

  return '';
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
     Preserve original behaviour:

     If the selected category contains fewer than
     four usable aircraft, fall back to the full
     usable aircraft collection.
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

  /*
    Group every manifest entry by aircraft TYPE.

    Multiple photographs of the same type remain available,
    but the type itself can only be selected once per cycle.
  */
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

  /*
    The queue contains aircraft TYPE keys, not individual
    manifest entries.

    This guarantees each type occurs only once per cycle.
  */
  const availableTypeKeys = new Set(aircraftByType.keys());

  aircraftQueue = aircraftQueue.filter((item) =>
    availableTypeKeys.has(getAircraftTypeKey(item)),
  );

  /*
    Start a new cycle containing every aircraft type exactly once.
  */
  if (aircraftQueue.length === 0) {
    aircraftQueue = [...aircraftByType.values()].map((entries) => {
      /*
        Use one representative entry for the queue.
        The actual question photo is selected randomly
        when the type is drawn below.
      */
      return entries[0];
    });

    shuffle(aircraftQueue);
  }

  /*
    Take the next aircraft TYPE from the cycle.
  */
  const typeRepresentative = aircraftQueue.pop();

  const typeKey = getAircraftTypeKey(typeRepresentative);

  /*
    Find EVERY manifest photo belonging to this aircraft type.
  */
  const photosForType = aircraftByType.get(typeKey);

  if (!photosForType || photosForType.length === 0) {
    return typeRepresentative;
  }

  /*
    Randomly choose the actual question photograph from
    ALL available manifest entries for this aircraft type.
  */
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

  /*
     Correct answer must always be included first.
  */

  const uniqueAircraft = [correctAircraft];

  const usedAnswers = new Set([correctAnswer]);

  /*
     Build unique distractor pool.
  */

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

  /*
     Prefer same-category distractors.
  */

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

  /*
     Fill remaining slots globally.
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
  /*
    Choose Photo:
    - Exactly 4 choices
    - All 4 must be from the SAME category
    - All 4 must be different aircraft types
    - The correct aircraft is always included
  */

  const correctCategory = displayText(correctAircraft?.category);

  /*
    Only aircraft belonging to the current aircraft's
    category can be used as choices.
  */
  const categoryPool = aircraft.filter((item) => {
    return (
      displayText(item?.category) === correctCategory &&
      getImagePath(item) &&
      displayText(item?.name)
    );
  });

  /*
    Group by aircraft type so multiple photos of the
    same aircraft cannot appear as separate choices.
  */
  const uniqueByType = new Map();

  for (const item of categoryPool) {
    const typeKey = getAircraftTypeKey(item);

    if (!typeKey) {
      continue;
    }

    /*
      Always prefer the actual current aircraft entry
      for the correct answer.
    */
    if (item === correctAircraft || !uniqueByType.has(typeKey)) {
      uniqueByType.set(typeKey, item);
    }
  }

  /*
    Force the current aircraft into the collection.
  */
  const correctTypeKey = getAircraftTypeKey(correctAircraft);

  uniqueByType.set(correctTypeKey, correctAircraft);

  /*
    Remove the correct aircraft type from the distractors.
  */
  const distractors = [...uniqueByType.values()].filter(
    (item) =>
      getAircraftTypeKey(item) !== correctTypeKey &&
      displayText(item.category) === correctCategory,
  );

  shuffle(distractors);

  /*
    Exactly:
      1 correct aircraft
      3 different aircraft types
  */
  const choices = [
    correctAircraft,
    distractors[0],
    distractors[1],
    distractors[2],
  ];

  /*
    Safety check — should never fail given your manifest.
  */
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
  /*
     Build the whole prompt in one operation so
     screen readers do not receive several partial
     announcements.
  */

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

  /*
     Category hint.
  */

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

    button.setAttribute('aria-keyshortcuts', String(index + 1));
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

    /*
      Aircraft photograph.
    */
    const img = document.createElement('img');

    img.src = getImagePath(choice.aircraft);
    img.alt = `Aircraft photo option ${index + 1}`;
    img.draggable = false;

    /*
      Aircraft name.

      Hidden until the question has been answered.
      The CSS reserves the space, so revealing the name
      does NOT move or resize the photograph.
    */
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

    button.setAttribute('aria-keyshortcuts', String(index + 1));
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

  /*
     Exact match gives a full mark.
  */

  if (typedWords.join(' ') === correctWords.join(' ')) {
    return 1;
  }

  /*
     Match words position-by-position.
  */

  const maxWords = correctWords.length;

  let matchedWords = 0;

  const usedCorrectIndexes = new Set();

  for (let i = 0; i < typedWords.length; i += 1) {
    if (i < correctWords.length && typedWords[i] === correctWords[i]) {
      matchedWords += 1;

      usedCorrectIndexes.add(i);
    }
  }

  /*
     Then allow matching words elsewhere.
  */

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
// Answer typed question
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

function submitTypedAnswer() {
  if (answered) {
    return;
  }

  if (!currentAircraft) {
    return;
  }

  const typedAnswer = typeAnswerInput.value;

  const correctAnswer = getAnswerValue(currentAircraft, currentQuestionType);

  const points = calculatePartialScore(typedAnswer, correctAnswer);

  answered = true;

  total += 1;

  score = Math.round((score + points) * 100) / 100;

  typeAnswerInput.classList.remove('correct', 'partial', 'incorrect');

  typeAnswerContainer.classList.remove('correct', 'partial', 'incorrect');

  if (points === 1) {
    streak += 1;

    typeAnswerInput.classList.add('correct');
    typeAnswerContainer.classList.add('correct');

    setFeedback('correct', '✓ Correct!');
  } else if (points > 0) {
    streak = 0;

    typeAnswerInput.classList.add('partial');
    typeAnswerContainer.classList.add('partial');

    setFeedback(
      'partial',
      `◐ Partial · ${formatPointsWithGrammar(points)}`,
      'Correct answer:',
      correctAnswer,
    );
  } else {
    streak = 0;

    typeAnswerInput.classList.add('incorrect');
    typeAnswerContainer.classList.add('incorrect');

    setFeedback('incorrect', '✕ Incorrect', 'Correct answer:', correctAnswer);
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

  const correctAnswer = getAnswerValue(currentAircraft, currentQuestionType);

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
    streak += 1;

    button.classList.add('correct');

    setFeedback('correct', '✓ Correct!');
  } else {
    streak = 0;

    button.classList.add('incorrect');

    setFeedback('incorrect', '✕ Incorrect', 'Correct answer:', correctAnswer);

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
  const correctAnswer = getAnswerValue(currentAircraft, currentQuestionType);

  answered = true;
  total += 1;

  // Reveal ALL 4 names after selection.
  answerButtons.forEach((answerButton) => {
    const nameElement = answerButton.querySelector('.photo-choice-name');

    if (nameElement) {
      nameElement.classList.remove('hidden-name');
    }
  });

  if (isCorrect) {
    score += 1;
    streak += 1;

    button.classList.add('correct');

    setFeedback('correct', '✓ Correct!');
  } else {
    streak = 0;

    button.classList.add('incorrect');

    setFeedback('incorrect', '✕ Incorrect', 'Correct photo:', correctAnswer);

    // Mark the correct photo as well.
    answerButtons.forEach((answerButton) => {
      if (answerButton.dataset.correct === 'true') {
        answerButton.classList.add('correct');
      }
    });
  }

  // Disable all photo choices.
  answerButtons.forEach((answerButton) => {
    answerButton.disabled = true;
  });

  updateScore();

  nextButton.disabled = false;
  nextButton.focus();
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

/*
   Find the answer button spatially closest
   in a requested direction.

   This works for:

   - 2 x 2 reverse photo grids
   - 2-column MCQs
   - 1-column mobile MCQs
*/

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

    /*
       Strongly prioritise candidates in
       the requested direction.
    */

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

    /*
       Focus first photo choice so keyboard
       users can immediately use 1–4,
       arrows, Enter or Space.
    */

    focusFirstAnswer();

    return;
  }

  // -------------------------------------------------------
  // Type answer mode
  // -------------------------------------------------------

  if (answerMode === 'type') {
    imageContainer.hidden = false;

    const imagePath = getImagePath(currentAircraft);

    if (!imagePath) {
      setLoading(false);

      feedbackElement.textContent = 'Image unavailable.';

      return;
    }

    imageElement.onload = () => {
      setLoading(false);

      typeAnswerInput.disabled = false;

      submitAnswerButton.disabled = false;

      /*
         Keyboard users can immediately begin typing.
      */

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

  const imagePath = getImagePath(currentAircraft);

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

    /*
       Put keyboard focus on the first answer.
    */

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

submitAnswerButton.addEventListener('click', () => {
  submitTypedAnswer();
});

typeAnswerInput.addEventListener('keydown', (event) => {
  /*
       Enter submits typed answer.

       Only submit when the button is enabled.
    */

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
  /*
       Do not trigger global shortcuts while
       the user is typing or operating a select.
    */

  const typingTarget = isTypingTarget(event.target);

  // -----------------------------------------------------
  // Typed answer mode
  // -----------------------------------------------------

  /*
       Enter is handled separately by the input
       listener above.
    */

  if (typingTarget) {
    return;
  }

  // -----------------------------------------------------
  // Ignore modified shortcuts
  // -----------------------------------------------------

  /*
       Prevent conflicts with browser / OS
       shortcuts such as Ctrl+1, Alt+1,
       Cmd+1, etc.
    */

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  // -----------------------------------------------------
  // Next shortcut
  // -----------------------------------------------------

  /*
       N always moves to the next question when
       the Next button is available.

       This also works when focus is in the
       main document rather than on the button.
    */

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

  /*
       When the question has already been answered,
       Enter or Space advances.

       Native button behaviour remains intact,
       so pressing Enter/Space while the Next
       button is focused works normally.
    */

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

  /*
       Works in BOTH:

       - Multiple-choice mode
       - Reverse photo mode

       Number shortcuts intentionally do not work
       inside text inputs or select controls.
    */

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

  /*
       Arrow keys work when one of the answer
       buttons currently has focus.

       This gives natural keyboard navigation
       for both text options and photo grids.
    */

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

    /*
       Put the user at the error message.
    */

    promptElement.focus();
  }
}

start();
