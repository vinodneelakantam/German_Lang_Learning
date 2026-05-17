(function () {
  const config = window.CHAPTER_CONFIG;
  if (!config) return;

  const state = {
    rate: 1.0,
    playbackActive: false,
    playbackPaused: false,
    playbackTimerA: null,
    playbackTimerB: null,
    autoPlayNextCategories: true,
    lastPlaybackStarter: null,
    activePlaybackRow: null,
    activeAutoQueue: [],
    activeQueueIndex: 0,
    orderedLessons: [],
    lessonOrder: {},
    availableVoices: [],
    speakerVoiceMap: {}
  };

  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const listeningChapterOrder = [
    'chapter-01-core-basics.html',
    'chapter-02-airport-and-conversations.html',
    'chapter-03-housing-and-utilities.html',
    'chapter-04-work-and-jobs.html',
    'chapter-05-health-and-medical.html',
    'chapter-06-transport-and-commuting.html',
    'chapter-07-role-play-scenarios.html',
    'chapter-08-german-only-topics.html'
  ];

  function getCurrentListeningChapterIndex() {
    const path = (window.location.pathname || '').toLowerCase();
    const chapterFile = path.split('/').pop();
    return listeningChapterOrder.findIndex((name) => name === chapterFile);
  }

  function getNextListeningChapterUrl() {
    const index = getCurrentListeningChapterIndex();
    if (index < 0 || index >= listeningChapterOrder.length - 1) return '';
    return listeningChapterOrder[index + 1];
  }

  function moveToNextListeningChapter() {
    const nextChapter = getNextListeningChapterUrl();
    if (!nextChapter) return false;

    const url = new URL(nextChapter, window.location.href);
    url.searchParams.set('autoplay', '1');
    url.searchParams.set('rate', String(state.rate));
    window.location.href = url.toString();
    return true;
  }

  function applyPlaybackParamsFromQuery() {
    const params = new URLSearchParams(window.location.search || '');
    const rate = Number.parseFloat(params.get('rate') || '');
    if (!Number.isNaN(rate)) {
      state.rate = Math.min(2, Math.max(0.1, rate));
      const speedSelect = document.querySelector('.topbar select');
      if (speedSelect) speedSelect.value = String(state.rate);
    }
  }

  function autoStartFromQuery() {
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('autoplay') !== '1') return;
    setTimeout(() => {
      startFromFirstAvailableContent();
    }, 300);
  }

  function startFromFirstAvailableContent() {
    if (state.orderedLessons.length) {
      const firstLesson = state.orderedLessons[0];
      window.playLesson(firstLesson.lessonName, firstLesson.categoryTitle);
      return true;
    }

    const scenarios = config.rolePlayScenarios || [];
    if (scenarios.length) {
      const firstScenario = scenarios[0];
      window.playRolePlay(firstScenario.lines || [], firstScenario.title || 'Role Play', firstScenario.context || '', 0);
      return true;
    }

    return false;
  }

  function lessonRowId(lessonName, rowIndex) {
    const safeLesson = slugify(lessonName);
    return `lesson-row-${safeLesson}-${rowIndex}`;
  }

  function rolePlayRowId(scenarioIndex, rowIndex) {
    return `roleplay-row-${scenarioIndex}-${rowIndex}`;
  }

  function clearPlaybackHighlight() {
    if (state.activePlaybackRow) {
      state.activePlaybackRow.classList.remove('is-playing');
      state.activePlaybackRow = null;
    }
  }

  function highlightPlaybackRowById(rowId) {
    clearPlaybackHighlight();
    if (!rowId) return;
    const row = document.getElementById(rowId);
    if (!row) return;
    state.activePlaybackRow = row;
    row.classList.add('is-playing');
    row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }

  function say(text, lang, cancelFirst, onEnd, options) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = state.rate;
    const resolvedVoice = (options && options.voice) || resolveVoice(lang, options || {});
    if (resolvedVoice) utterance.voice = resolvedVoice;
    if (onEnd) {
      utterance.onend = onEnd;
      utterance.onerror = onEnd;
    }
    if (cancelFirst) window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  window.speakCell = function (text, lang) {
    say(text, lang, true);
  };

  window.setSpeed = function (v) {
    const nextRate = Number.parseFloat(v);
    if (Number.isNaN(nextRate)) return;
    state.rate = Math.min(2, Math.max(0.1, nextRate));
  };

  function setPlaybackStatus(message) {
    const label = document.getElementById('playbackStatus');
    if (label) label.textContent = message;
  }

  function clearPlaybackTimers() {
    if (state.playbackTimerA) clearTimeout(state.playbackTimerA);
    if (state.playbackTimerB) clearTimeout(state.playbackTimerB);
    state.playbackTimerA = null;
    state.playbackTimerB = null;
  }

  function loadVoices() {
    state.availableVoices = window.speechSynthesis.getVoices() || [];
  }

  function languageCode(lang) {
    return String(lang || '').toLowerCase().split('-')[0];
  }

  function scoreVoiceByHint(voiceName, voiceHint) {
    const hint = String(voiceHint || '').toLowerCase();
    if (!hint) return 0;

    const malePattern = /(male|mann|herr|daniel|thomas|markus|hans|stefan|matthias|christian|joachim|oliver|viktor|wolfgang)/i;
    const femalePattern = /(female|frau|anna|petra|katja|sabine|julia|maria|sarah|eva|nora|lisa)/i;

    if (hint === 'male') {
      if (malePattern.test(voiceName)) return 30;
      if (femalePattern.test(voiceName)) return -20;
    }

    if (hint === 'female') {
      if (femalePattern.test(voiceName)) return 30;
      if (malePattern.test(voiceName)) return -20;
    }

    return 0;
  }

  function resolveVoice(lang, opts) {
    loadVoices();
    const options = opts || {};
    const allVoices = state.availableVoices || [];
    if (!allVoices.length) return null;

    const targetCode = languageCode(lang);
    let candidates = allVoices.filter((voice) => languageCode(voice.lang) === targetCode);
    if (!candidates.length) candidates = allVoices;

    let best = null;
    let bestScore = -1e9;

    candidates.forEach((voice) => {
      let score = 0;
      score += scoreVoiceByHint(voice.name || '', options.voiceHint);
      if (options.avoidVoiceName && voice.name === options.avoidVoiceName) score -= 80;
      if (voice.default) score += 5;

      if (score > bestScore) {
        best = voice;
        bestScore = score;
      }
    });

    return best;
  }

  function getSpeakerProfile(speakerName) {
    const map = config.rolePlaySpeakers || {};
    if (!speakerName || typeof map !== 'object') return {};
    return map[speakerName] || {};
  }

  function getVoiceForSpeaker(speakerName, lang) {
    if (!speakerName) return null;

    const assignedVoiceName = state.speakerVoiceMap[speakerName];
    if (assignedVoiceName) {
      loadVoices();
      const existing = (state.availableVoices || []).find((voice) => voice.name === assignedVoiceName);
      if (existing) return existing;
    }

    const profile = getSpeakerProfile(speakerName);
    const usedVoiceNames = Object.values(state.speakerVoiceMap);
    const avoidVoiceName = usedVoiceNames.length ? usedVoiceNames[0] : '';
    const voice = resolveVoice(lang, {
      voiceHint: profile.voiceHint,
      avoidVoiceName
    });

    if (voice) state.speakerVoiceMap[speakerName] = voice.name;
    return voice;
  }

  function stopPlayback() {
    state.playbackActive = false;
    state.playbackPaused = false;
    clearPlaybackTimers();
    clearPlaybackHighlight();
    state.activeAutoQueue = [];
    state.activeQueueIndex = 0;
    state.speakerVoiceMap = {};
    window.speechSynthesis.cancel();
    setPlaybackStatus('Stopped');
  }

  function pausePlayback() {
    if (!state.playbackActive || state.playbackPaused) return;
    state.playbackPaused = true;
    clearPlaybackTimers();
    window.speechSynthesis.cancel();
    setPlaybackStatus('Paused');
  }

  function resumePlayback() {
    if (!state.playbackActive || !state.playbackPaused) return;
    state.playbackPaused = false;
    setPlaybackStatus('Resumed');
    if (state.activeAutoQueue.length) {
      playNextQueuedLesson();
    }
  }

  window.setAutoPlayNext = function (enabled) {
    state.autoPlayNextCategories = !!enabled;
  };

  window.handlePlaybackAction = function (action) {
    if (!action) return;

    if (action === 'play') {
      if (state.playbackActive && state.playbackPaused) {
        resumePlayback();
      } else if (!state.playbackActive && state.lastPlaybackStarter) {
        state.lastPlaybackStarter();
      } else if (state.playbackActive) {
        setPlaybackStatus('Already playing');
      } else {
        const started = startFromFirstAvailableContent();
        if (!started) setPlaybackStatus('No playable content found');
      }
    } else if (action === 'pause') {
      pausePlayback();
    } else if (action === 'stop') {
      stopPlayback();
    }
  };

  function getCategoryIntro(categoryTitle) {
    if (!categoryTitle) return '';
    const details = (config.categoryDescriptions || {})[categoryTitle];
    if (config.practiceMode === 'de-de') {
      if (details) {
        return `Thema ${categoryTitle}. In diesem Abschnitt uebst du nur Deutsch mit einfachen Saetzen. ${details}`;
      }
      return `Thema ${categoryTitle}. In diesem Abschnitt uebst du nur Deutsch mit einfachen Saetzen.`;
    }
    if (details) {
      return `You are in ${categoryTitle}. Under this topic, you will practice English and German vocabulary for daily life. ${details}`;
    }
    return `You are in ${categoryTitle}. Under this topic, you will practice English and German vocabulary for daily life.`;
  }

  function getColumnLang(columnIndex) {
    const langs = config.columnLangs || [];
    if (langs[columnIndex]) return langs[columnIndex];
    return columnIndex === 0 ? 'en-US' : 'de-DE';
  }

  function getColumnLabel(columnIndex) {
    const labels = config.columnLabels || [];
    if (labels[columnIndex]) return labels[columnIndex];
    return columnIndex === 0 ? 'English' : 'German';
  }

  function speakIntroThen(introText, startPlayback) {
    if (!introText) {
      startPlayback();
      return;
    }

    let finished = false;
    const finishOnce = () => {
      if (finished || !state.playbackActive || state.playbackPaused) return;
      finished = true;
      startPlayback();
    };

    const intro = new SpeechSynthesisUtterance(introText);
    intro.lang = 'en-US';
    intro.rate = state.rate;
    intro.onend = finishOnce;
    intro.onerror = finishOnce;
    window.speechSynthesis.speak(intro);

    const words = introText.trim().split(/\s+/).filter(Boolean).length;
    const estimatedMs = Math.max(1800, Math.min(9000, words * 420));
    state.playbackTimerB = setTimeout(finishOnce, estimatedMs);
  }

  function playSingleLesson(lessonName, list, categoryTitle, announceCategory, onComplete) {
    const label = categoryTitle || 'Selected Category';
    setPlaybackStatus(`Now Playing: ${label}`);

    let i = 0;
    const stepGap = () => Math.max(120, Math.floor(320 / Math.max(state.rate, 0.1)));

    function run() {
      if (!state.playbackActive || state.playbackPaused) return;

      if (i < list.length) {
        const colA = list[i][0] || '';
        const colB = list[i][1] || '';
        const langA = getColumnLang(0);
        const langB = getColumnLang(1);
        highlightPlaybackRowById(lessonRowId(lessonName, i));

        const advanceToNext = () => {
          if (!state.playbackActive || state.playbackPaused) return;
          i++;
          state.playbackTimerB = setTimeout(run, stepGap());
        };

        const speakSecond = () => {
          if (!state.playbackActive || state.playbackPaused) return;
          if (colB) {
            say(colB, langB, false, advanceToNext);
          } else {
            advanceToNext();
          }
        };

        if (colA) {
          say(colA, langA, false, speakSecond);
        } else {
          speakSecond();
        }
      } else {
        clearPlaybackHighlight();
        if (onComplete) onComplete();
      }
    }

    if (announceCategory && categoryTitle) {
      speakIntroThen(getCategoryIntro(categoryTitle), () => {
        if (!state.playbackActive) return;
        state.playbackTimerB = setTimeout(run, 250);
      });
    } else {
      state.playbackTimerB = setTimeout(run, 0);
    }
  }

  function playNextQueuedLesson() {
    if (!state.playbackActive || state.playbackPaused) return;

    if (state.activeQueueIndex >= state.activeAutoQueue.length) {
      if (state.autoPlayNextCategories && moveToNextListeningChapter()) {
        setPlaybackStatus('Moving to next listening chapter...');
        return;
      }
      state.playbackActive = false;
      state.playbackPaused = false;
      setPlaybackStatus('Completed all categories');
      return;
    }

    const item = state.activeAutoQueue[state.activeQueueIndex];
    const previous = state.activeAutoQueue[state.activeQueueIndex - 1];
    const announceCategory = !previous || previous.sectionIndex !== item.sectionIndex;

    playSingleLesson(item.lessonName, item.list, item.categoryTitle, announceCategory, () => {
      if (!state.playbackActive) return;
      state.activeQueueIndex++;
      playNextQueuedLesson();
    });
  }

  window.playLesson = function (lessonName, categoryTitle) {
    state.lastPlaybackStarter = () => window.playLesson(lessonName, categoryTitle);
    stopPlayback();

    const start = state.lessonOrder[lessonName];
    if (!start) {
      setPlaybackStatus('Could not start playback');
      return;
    }

    state.activeAutoQueue = state.autoPlayNextCategories
      ? state.orderedLessons.filter(item => item.sectionIndex >= start.sectionIndex)
      : state.orderedLessons.filter(item => item.sectionIndex === start.sectionIndex);

    state.activeQueueIndex = 0;
    state.playbackActive = true;
    state.playbackPaused = false;

    const mode = state.autoPlayNextCategories ? 'Auto' : 'Single Category';
    setPlaybackStatus(`Starting (${mode}): ${categoryTitle || 'Selected Category'}`);
    playNextQueuedLesson();
  };

  window.playRolePlay = function (dialog, title, contextText, scenarioIndex) {
    state.lastPlaybackStarter = () => window.playRolePlay(dialog, title, contextText, scenarioIndex);
    stopPlayback();
    state.playbackActive = true;
    state.playbackPaused = false;
    setPlaybackStatus(`Now Playing Role Play: ${title}`);

    let i = 0;
    const stepGap = () => Math.max(140, Math.floor(360 / Math.max(state.rate, 0.1)));

    function run() {
      if (!state.playbackActive || state.playbackPaused) return;
      const speakerTextMode = config.rolePlayFormat === 'speaker-text';

      if (i < dialog.length) {
        highlightPlaybackRowById(rolePlayRowId(scenarioIndex, i));

        const advanceToNext = () => {
          if (!state.playbackActive || state.playbackPaused) return;
          i++;
          state.playbackTimerB = setTimeout(run, stepGap());
        };

        if (speakerTextMode) {
          const row = dialog[i] || {};
          const speaker = row.speaker || '';
          const text = row.text || '';
          const voice = getVoiceForSpeaker(speaker, 'de-DE');

          if (text) {
            say(text, 'de-DE', false, advanceToNext, { voice });
          } else {
            advanceToNext();
          }
        } else {
          const colA = dialog[i][0] || '';
          const colB = dialog[i][1] || '';
          const langA = getColumnLang(0);
          const langB = getColumnLang(1);

          const speakSecond = () => {
            if (!state.playbackActive || state.playbackPaused) return;
            if (colB) {
              say(colB, langB, false, advanceToNext);
            } else {
              advanceToNext();
            }
          };

          if (colA) {
            say(colA, langA, false, speakSecond);
          } else {
            speakSecond();
          }
        }
      } else {
        state.playbackActive = false;
        state.playbackPaused = false;
        clearPlaybackHighlight();
        setPlaybackStatus(`Completed role play: ${title}`);
      }
    }

    const introText = contextText
      ? `You are in Role Play Scenarios. Play practical conversations for daily immigrant and tourist situations. Now playing ${title}. ${contextText}`
      : `You are in Role Play Scenarios. Now playing ${title}.`;

    speakIntroThen(introText, () => {
      if (!state.playbackActive) return;
      state.playbackTimerB = setTimeout(run, 250);
    });
  };

  function renderLessonCard(categoryTitle, lessonName, lessonEntries) {
    const columnALabel = getColumnLabel(0);
    const columnBLabel = getColumnLabel(1);
    const columnALang = getColumnLang(0);
    const columnBLang = getColumnLang(1);

    const lessonRows = lessonEntries
      .map((p, rowIndex) => {
        const rowId = lessonRowId(lessonName, rowIndex);
        const enCell = `<td class="speak-cell english" onclick="speakCell('${esc(p[0])}','${esc(columnALang)}')">${p[0] || ''}</td>`;
        const deCell = p[1]
          ? `<td class="speak-cell german" onclick="speakCell('${esc(p[1])}','${esc(columnBLang)}')">${p[1]}</td>`
          : '<td></td>';

        return `<tr id="${rowId}">${enCell}${deCell}</tr>`;
      })
      .join('');

    return `
      <div class="lesson">
        <div class="lesson-head">
          <div>
            <button class="play-btn" onclick="playLesson('${esc(lessonName)}','${esc(categoryTitle || '')}')">▶ Play</button>
          </div>
        </div>
        <div class="entries">
          <table class="vocab-table">
            <thead>
              <tr>
                <th>${columnALabel}</th>
                <th>${columnBLabel}</th>
              </tr>
            </thead>
            <tbody>${lessonRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderRolePlaySection() {
    const scenarios = config.rolePlayScenarios || [];
    if (!scenarios.length) return;

    const columnALabel = getColumnLabel(0);
    const columnBLabel = getColumnLabel(1);
    const columnALang = getColumnLang(0);
    const columnBLang = getColumnLang(1);
    const speakerTextMode = config.rolePlayFormat === 'speaker-text';

    const rolePlayContainer = document.getElementById('rolePlayContainer');
    const rolePlayPrefaceLinks = document.getElementById('rolePlayPrefaceLinks');
    const rolePlaySection = document.getElementById('rolePlaySection');
    if (!rolePlayContainer || !rolePlayPrefaceLinks || !rolePlaySection) return;

    rolePlaySection.style.display = 'block';

    scenarios.forEach((scenario, index) => {
      const scenarioId = `scenario-${slugify(scenario.title)}`;
      rolePlayPrefaceLinks.innerHTML += `<a class="jump-link" href="#${scenarioId}">${scenario.title}</a>`;

      const rows = scenario.lines
        .map((line, lineIndex) => {
          const rowId = rolePlayRowId(index, lineIndex);

          if (speakerTextMode) {
            const speaker = line.speaker || '';
            const text = line.text || '';
            const speakerCell = `<td>${speaker}</td>`;
            const textCell = text ? `<td class="speak-cell german" onclick="speakCell('${esc(text)}','de-DE')">${text}</td>` : '<td></td>';
            return `<tr id="${rowId}">${speakerCell}${textCell}</tr>`;
          }

          const en = line[0] || '';
          const de = line[1] || '';
          const enCell = en ? `<td class="speak-cell english" onclick="speakCell('${esc(en)}','${esc(columnALang)}')">${en}</td>` : '<td></td>';
          const deCell = de ? `<td class="speak-cell german" onclick="speakCell('${esc(de)}','${esc(columnBLang)}')">${de}</td>` : '<td></td>';
          return `<tr id="${rowId}">${enCell}${deCell}</tr>`;
        })
        .join('');

      rolePlayContainer.innerHTML += `
        <article id="${scenarioId}" class="scenario-card">
          <div class="scenario-head">
            <h3>${scenario.title}</h3>
            <div>
              <button class="play-role-btn" onclick="playRolePlay(window.CHAPTER_CONFIG.rolePlayScenarios[${index}].lines,'${esc(scenario.title)}','${esc(scenario.context)}',${index})">▶ Play</button>
            </div>
          </div>
          <p class="scenario-sub">${scenario.context || ''}</p>
          <div class="entries">
            <table class="dialog-table">
              <thead>
                <tr>
                  <th>${columnALabel}</th>
                  <th>${columnBLabel}</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </article>`;
    });
  }

  function renderChapter() {
    const titleNode = document.getElementById('appTitle');
    const subtitleNode = document.getElementById('appSubtitle');
    const signatureName = document.getElementById('signatureName');
    const signatureLink = document.getElementById('signatureLink');
    const container = document.getElementById('lessonsContainer');
    const topicPrefaceLinks = document.getElementById('topicPrefaceLinks');

    if (titleNode) titleNode.textContent = config.title || 'German Chapter';
    if (subtitleNode) subtitleNode.textContent = config.subtitle || 'Click any word to hear it.';
    if (signatureName) signatureName.textContent = (config.signature && config.signature.name) || 'Vinod Kumar Neelakantam';
    if (signatureLink) {
      signatureLink.textContent = (config.signature && config.signature.linkText) || 'linkedin.com/in/vinodneelakantam';
      signatureLink.href = (config.signature && config.signature.linkHref) || 'https://www.linkedin.com/in/vinodneelakantam/';
    }

    const categories = config.categories || [];
    let totalEntries = 0;

    categories.forEach((section, sectionIndex) => {
      const lessonCards = (section.lessons || [])
        .map((lesson) => {
          if (!lesson || !Array.isArray(lesson.entries)) return '';
          totalEntries += lesson.entries.length;

          const item = {
            lessonName: lesson.name,
            categoryTitle: section.title,
            list: lesson.entries,
            sectionIndex
          };

          state.orderedLessons.push(item);
          state.lessonOrder[lesson.name] = item;

          return renderLessonCard(section.title, lesson.name, lesson.entries);
        })
        .join('');

      if (lessonCards) {
        const sectionId = `cat-${slugify(section.title)}`;
        const sectionCount = (section.lessons || []).reduce((sum, lesson) => sum + (lesson.entries ? lesson.entries.length : 0), 0);
        topicPrefaceLinks.innerHTML += `<a class="jump-link" href="#${sectionId}">${section.title} (${sectionCount})</a>`;

        container.innerHTML += `
          <section id="${sectionId}" class="category">
            <h3 class="category-title">${section.title}</h3>
            <p class="category-note">${section.description || 'Practical vocabulary practice for everyday communication.'}</p>
            <div class="category-grid">${lessonCards}</div>
          </section>`;
      }
    });

    totalEntries += (config.rolePlayScenarios || []).reduce((sum, scenario) => {
      return sum + ((scenario.lines || []).length);
    }, 0);

    const totalCountNode = document.getElementById('totalCount');
    if (totalCountNode) totalCountNode.textContent = totalEntries;

    renderRolePlaySection();
  }

  loadVoices();
  const previousVoicesChanged = window.speechSynthesis.onvoiceschanged;
  window.speechSynthesis.onvoiceschanged = function () {
    loadVoices();
    if (typeof previousVoicesChanged === 'function') previousVoicesChanged();
  };

  applyPlaybackParamsFromQuery();
  renderChapter();
  autoStartFromQuery();
})();
