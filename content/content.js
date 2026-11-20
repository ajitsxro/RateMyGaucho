(async function initRateMyGaucho() {
	let path = location.pathname || '';
	try { if (window.top && window.top.location) path = window.top.location.pathname || path; } catch {}
	if (!/\/gold\//i.test(path) || /logout\.aspx$/i.test(path)) return;
	const settings = await loadSettings();
	if (settings && settings.enabled === false) return;
	observeAndRender();
	renderNLPSearchBar();
})();

function loadSettings() {
	return new Promise(resolve => {
		try { chrome.storage?.local?.get({ enabled: true, compactMode: false }, resolve); }
		catch { resolve({ enabled: true, compactMode: false }); }
	});
}

// Module-level dedup sets — persist across scan() calls so MutationObserver re-entries don't duplicate
const __rmg_renderedCourseInstructors = new Set();
const __rmg_renderedCourseOnly = new Set();

function observeAndRender() {
	let scanPending = false;
	let scanRunning = false;
	const observer = new MutationObserver(() => {
		if (!scanPending && !scanRunning) {
			scanPending = true;
			scheduleScan();
		}
	});
	observer.observe(document, { childList: true, subtree: true });
	scheduleScan();

	async function scheduleScan() {
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(async () => { await scan(); scanPending = false; });
		else setTimeout(async () => { await scan(); scanPending = false; }, 50);
	}

	async function scan() {
		if (scanRunning) return;
		scanRunning = true;
		// Disconnect observer while we mutate the DOM to avoid cascading re-scans
		observer.disconnect();
		try {
			await doScan();
		} finally {
			scanRunning = false;
			observer.observe(document, { childList: true, subtree: true });
		}
	}

	async function doScan() {
		const nodes = findInstructorNodes();
		if (!nodes.length) return;
		const lookup = await ensureRatingsLoaded();
		const courseLookup = await ensureCoursesLoaded();
		// Do NOT bail if lookup (scores.csv) is null — we can still show course data
		if (!lookup && !courseLookup) return;
		
		for (const node of nodes) {
			if (node.dataset.rmgInitialized === '1') continue;
			node.dataset.rmgInitialized = '1';

			// Prevent duplicate cards per table row (cards are now in sibling rows)
			const row = node.closest && node.closest('tr');
			if (row) {
				// Check if this row already has a card, or the next sibling is a card row
				if (row.querySelector('.rmg-card')) continue;
				const nextRow = row.nextElementSibling;
				if (nextRow && nextRow.classList.contains('rmg-card-row')) continue;
			}

			const info = extractInstructorInfo(node);
			const match = lookup ? matchInstructor(info, lookup) : null;
			const courseCode = extractCourseCode(node);
			const courseList = courseCode && courseLookup ? courseLookup.get(normalizeCourseCode(courseCode)) : null;
			const courseData = Array.isArray(courseList) ? pickCourseDataForInstructor(courseList, match) : null;

			// De-duplicate: also check if the DOM already has a card for this course
			if (row) {
				if (row.querySelectorAll('.rmg-card-wrapper').length > 0) continue;
				const nextSib = row.nextElementSibling;
				if (nextSib && nextSib.classList.contains('rmg-card-row')) continue;
			}
			
			// Determine gated course data (verify instructor matches course)
			let gatedCourseData = null;
			if (courseData) {
				if (match) {
					const verifiedByCsvProfessor = csvProfessorMatches(courseData, match);
					const verifiedByFlag = typeof courseData?.reviewVerification === 'string'
						&& courseData.reviewVerification.toUpperCase().includes('MATCH');
					const hasInstructorSpecificReviews = (
						courseData._reviewsFiltered
						&& Array.isArray(courseData.recentReviews)
						&& courseData.recentReviews.length > 0
					);
					
					gatedCourseData = (hasInstructorSpecificReviews || verifiedByCsvProfessor || verifiedByFlag)
						? courseData
						: null;
				} else {
					// No ratings match — show course data ungated (we can't verify by instructor)
					gatedCourseData = courseData;
				}
			}
			
			if (match) {
				// Only one card per course + instructor combination on the whole page
				const instructorKey = `${match.lastName}|${match.firstName}`;
				const courseInstructorKey = `${courseCode || 'none'}:${instructorKey}`;
				if (__rmg_renderedCourseInstructors.has(courseInstructorKey)) continue;
				__rmg_renderedCourseInstructors.add(courseInstructorKey);

				renderCard(node, match, gatedCourseData);
			} else if (gatedCourseData) {
				// Only one course-only card per course code on the page
				const courseOnlyKey = `courseonly:${courseCode || 'none'}`;
				if (__rmg_renderedCourseOnly.has(courseOnlyKey)) continue;
				__rmg_renderedCourseOnly.add(courseOnlyKey);

				renderCard(node, null, gatedCourseData);
			}
		}
	}
}

function renderCard(anchorNode, record, courseData = null) {
	const card = document.createElement('div');
	const hasRmpRatings = record && Number.isFinite(Number(record.rmpScore));
	const hasGpa = courseData && Number.isFinite(courseData.avgGpa) && courseData.avgGpa > 0;
	// Use RMP score if available, otherwise derive a 5-star rating from GPA (4.0 scale → 5.0 scale)
	const hasAnyRating = hasRmpRatings || hasGpa;
	const rating = hasRmpRatings ? Number(record.rmpScore)
		: hasGpa ? Math.min(5, (courseData.avgGpa / 4.0) * 5) : 0;
	card.className = 'rmg-card ' + (hasAnyRating ? (rating >= 4 ? 'rmg-good' : rating >= 3 ? 'rmg-ok' : 'rmg-bad') : 'rmg-ok');

	const badge = document.createElement('span');
	badge.className = 'rmg-badge';
	if (hasRmpRatings) {
		badge.textContent = rating.toFixed(1);
		badge.classList.add(
			rating >= 4 ? 'rmg-badge--good' : rating >= 3 ? 'rmg-badge--ok' : 'rmg-badge--bad'
		);
	} else if (hasGpa) {
		badge.textContent = courseData.avgGpa.toFixed(1);
		badge.title = 'Avg GPA';
		badge.classList.add(
			courseData.avgGpa >= 3.5 ? 'rmg-badge--good' : courseData.avgGpa >= 2.5 ? 'rmg-badge--ok' : 'rmg-badge--bad'
		);
	} else {
		badge.textContent = '—';
		badge.classList.add('rmg-badge--ok');
	}

	const sub = document.createElement('span');
	sub.className = 'rmg-subtle';
	sub.textContent = hasRmpRatings ? `${record.numReviews} reviews`
		: (courseData ? courseData.courseName : '');

	const stars = document.createElement('div');
	stars.className = 'rmg-stars';
	
	// Create 5 gaucho star images with precise tenths-based partial fills
	for (let i = 0; i < 5; i++) {
		const starContainer = document.createElement('div');
		starContainer.className = 'rmg-star-container';
		
		const emptyStar = document.createElement('img');
		emptyStar.src = chrome.runtime.getURL('gaucho.png');
		emptyStar.className = 'rmg-star rmg-star--empty';
		emptyStar.alt = '★';
		
		const filledStar = document.createElement('img');
		filledStar.src = chrome.runtime.getURL('gaucho.png');
		filledStar.className = 'rmg-star rmg-star--filled';
		filledStar.alt = '★';
		
		const starValue = i + 1;
		let fillPercentage = 0;
		if (rating >= starValue) {
			fillPercentage = 100;
		} else if (rating > starValue - 1) {
			const partialRating = rating - (starValue - 1);
			fillPercentage = Math.max(0, Math.min(100, partialRating * 100));
		}
		starContainer.style.setProperty('--fill-percentage', `${fillPercentage}%`);
		
		starContainer.appendChild(emptyStar);
		starContainer.appendChild(filledStar);
		stars.appendChild(starContainer);
	}

	const meta = document.createElement('span');
	meta.className = 'rmg-meta';
	meta.textContent = '';

	const meter = document.createElement('div');
	meter.className = 'rmg-meter';
	const bar = document.createElement('span');
	meter.appendChild(bar);

	// Course metadata section (sparklines, grade pills, review)
	let courseMeta = null;
	if (courseData) {
		courseMeta = renderCourseMeta(courseData);
	}

	const actions = document.createElement('div');
	actions.className = 'rmg-actions';

	const link = document.createElement('a');
	link.className = 'rmg-link';
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.href = (record && record.profileUrl) ? record.profileUrl : (courseData && courseData.courseUrl ? courseData.courseUrl : 'https://ucsbplat.com/instructor/');
	link.textContent = 'UCSB Plat';

	card.appendChild(badge);
	card.appendChild(stars);
	card.appendChild(sub);
	if (courseMeta) {
		card.appendChild(courseMeta);
	}
	card.appendChild(meter);
	actions.appendChild(link);
	card.appendChild(actions);

	// Wrap in a container that enforces min-width even inside narrow <td>
	const wrapper = document.createElement('div');
	wrapper.className = 'rmg-card-wrapper';
	wrapper.appendChild(card);

	try {
		const row = anchorNode.closest && anchorNode.closest('tr');
		if (row && row.parentElement) {
			// Find the course header row (the dark-blue row with the course name
			// like "ECE 10C - FOUNDTN CIRC & SYS") above this instructor row.
			// Insert the card after that header row so it sits at the far left,
			// below the course title and above all section rows with buttons.
			let headerRow = null;
			let prev = row.previousElementSibling;
			for (let i = 0; prev && i < 15; i++) {
				const txt = (prev.textContent || '').trim();
				// Header rows typically have a <td colspan> with <strong> and a course code
				const hasStrong = prev.querySelector('strong, b, th');
				const hasCourseCode = /\b[A-Z]{2,8}\s+\d{1,3}[A-Z]*\b/.test(txt);
				if (hasStrong && hasCourseCode) {
					headerRow = prev;
					break;
				}
				// Also detect header rows by colspan (header rows span many columns)
				const firstTd = prev.querySelector('td[colspan], th[colspan]');
				if (firstTd && hasCourseCode) {
					headerRow = prev;
					break;
				}
				prev = prev.previousElementSibling;
			}

			const newRow = document.createElement('tr');
			newRow.className = 'rmg-card-row';
			const allCells = row.querySelectorAll('td, th');
			const colCount = allCells.length || 1;
			const newCell = document.createElement('td');
			newCell.colSpan = colCount;
			newCell.style.cssText = 'padding: 2px 4px 4px 4px; border: none; background: transparent; text-align: left;';
			newCell.appendChild(wrapper);
			newRow.appendChild(newCell);

			// Insert after the header row if found, otherwise after the instructor row
			const insertAfter = headerRow || row;
			// Make sure we don't double-insert: check if next sibling is already a card row
			const nextSib = insertAfter.nextElementSibling;
			if (nextSib && nextSib.classList.contains('rmg-card-row')) {
				// Already have a card here, skip
				return;
			}
			insertAfter.insertAdjacentElement('afterend', newRow);
		} else {
			const cell = anchorNode.closest && anchorNode.closest('td,th');
			if (cell) {
				cell.style.overflow = 'visible';
				cell.style.position = 'relative';
				cell.appendChild(wrapper);
			} else {
				anchorNode.insertAdjacentElement('afterend', wrapper);
			}
		}
	} catch (_e) {
		(anchorNode.parentElement || document.body).appendChild(wrapper);
	}

	requestAnimationFrame(() => {
		const pct = hasAnyRating ? Math.max(0, Math.min(100, (rating / 5) * 100)) : 0;
		bar.style.width = pct + '%';
	});
}

/**
 * Render course metadata: enrollment sparkline, grade pills, review quote.
 */
function renderCourseMeta(courseRec) {
	if (!courseRec) return null;

	const courseMeta = document.createElement('div');
	courseMeta.className = 'rmg-course';

	// Header with course name and grading basis
	const header = document.createElement('div');
	header.className = 'rmg-course-header';

	if (courseRec.courseName) {
		const courseTitle = document.createElement('div');
		courseTitle.className = 'rmg-course-title';
		courseTitle.textContent = courseRec.courseName;
		header.appendChild(courseTitle);
	}

	if (courseRec.gradingBasis) {
		const chip = document.createElement('span');
		chip.className = 'rmg-chip';
		chip.textContent = courseRec.gradingBasis;
		header.appendChild(chip);
	}

	courseMeta.appendChild(header);

	// Stats row with enrollment sparkline and grade pills
	const statsRow = document.createElement('div');
	statsRow.className = 'rmg-course-stats';

	// Enrollment trend with sparkline
	if (courseRec.enrollmentTrend && courseRec.enrollmentTrend.length > 0) {
		const enrollSection = document.createElement('div');
		enrollSection.className = 'rmg-stat-section';

		const enrollLabel = document.createElement('div');
		enrollLabel.className = 'rmg-stat-label';
		enrollLabel.textContent = 'Enrollment';
		enrollSection.appendChild(enrollLabel);

		const currentEnrollment = courseRec.enrollmentTrend[courseRec.enrollmentTrend.length - 1];
		if (typeof currentEnrollment === 'number') {
			const enrollNumber = document.createElement('div');
			enrollNumber.className = 'rmg-stat-number';
			enrollNumber.textContent = currentEnrollment.toString();
			enrollSection.appendChild(enrollNumber);
		}

		// Sparkline bar chart
		const enrollSpark = document.createElement('div');
		enrollSpark.className = 'rmg-sparkline';
		enrollSpark.setAttribute('aria-label', `Enrollment trend: ${courseRec.enrollmentTrend.join(' → ')}`);

		const maxVal = Math.max(...courseRec.enrollmentTrend.filter(v => typeof v === 'number' && !isNaN(v)));
		if (maxVal > 0) {
			courseRec.enrollmentTrend.forEach((val, i) => {
				if (typeof val === 'number' && !isNaN(val)) {
					const sparkBar = document.createElement('span');
					sparkBar.className = 'rmg-spark-bar';
					sparkBar.style.height = `${Math.max(2, (val / maxVal) * 18)}px`;
					sparkBar.title = `Quarter ${i + 1}: ${val} students`;
					enrollSpark.appendChild(sparkBar);
				}
			});
			enrollSection.appendChild(enrollSpark);
		}

		statsRow.appendChild(enrollSection);
	}

	// Grade distribution pills
	if (courseRec.gradingTrend && courseRec.gradingTrend.length > 0) {
		const gradeSection = document.createElement('div');
		gradeSection.className = 'rmg-stat-section';

		const gradeLabel = document.createElement('div');
		gradeLabel.className = 'rmg-stat-label';
		gradeLabel.textContent = 'Recent Grades';
		gradeSection.appendChild(gradeLabel);

		const gradeDisplay = document.createElement('div');
		gradeDisplay.className = 'rmg-grade-pills';

		// Show all grade entries as pills
		courseRec.gradingTrend.forEach((grade, i) => {
			if (typeof grade === 'string' && grade.trim()) {
				const gradePill = document.createElement('span');
				gradePill.className = `rmg-grade-pill rmg-grade-${getGradeClass(grade)}`;
				gradePill.textContent = grade.trim();
				gradePill.title = grade.trim();
				gradeDisplay.appendChild(gradePill);
			}
		});

		gradeSection.appendChild(gradeDisplay);
		statsRow.appendChild(gradeSection);
	}

	if (statsRow.children.length > 0) {
		courseMeta.appendChild(statsRow);
	}

	// Professor (PLAT)
	if (courseRec.csvProfessor) {
		const profLine = document.createElement('div');
		profLine.style.cssText = 'font-size:10px;color:rgba(0,54,96,0.7);margin-top:4px;';
		profLine.textContent = `Professor (PLAT): ${courseRec.csvProfessor}`;
		courseMeta.appendChild(profLine);
	}

	// Recent student review
	if (courseRec.recentReviews && courseRec.recentReviews.length > 0) {
		const firstReview = courseRec.recentReviews[0];
		if (typeof firstReview === 'string' && firstReview.trim()) {
			const reviewSection = document.createElement('div');
			reviewSection.className = 'rmg-review-section';

			const reviewIcon = document.createElement('span');
			reviewIcon.className = 'rmg-review-icon';
			reviewIcon.textContent = '💬';
			reviewSection.appendChild(reviewIcon);

			const reviewText = document.createElement('div');
			reviewText.className = 'rmg-review-text';
			const cleanReview = firstReview.replace(/[="]/g, '').trim();
			const truncatedReview = cleanReview.length > 100
				? cleanReview.slice(0, 100) + '…' : cleanReview;
			reviewText.textContent = `"${truncatedReview}"`;
			reviewSection.appendChild(reviewText);

			const reviewMeta = document.createElement('div');
			reviewMeta.className = 'rmg-review-meta';
			reviewMeta.textContent = 'Recent student feedback';
			reviewSection.appendChild(reviewMeta);

			courseMeta.appendChild(reviewSection);
		}
	}

	return courseMeta.children.length > 0 ? courseMeta : null;
}

// Helper function to determine grade class for styling
function getGradeClass(grade) {
	const g = (grade || '').trim().toUpperCase();
	// Handle formats like "A: 62.6%" or "A+" or "Pass: 100%"
	const letter = g.match(/^([A-F][+-]?|PASS|FAIL)/);
	if (!letter) return 'other';
	const l = letter[1];
	if (l.startsWith('A')) return 'excellent';
	if (l.startsWith('B')) return 'good';
	if (l.startsWith('C')) return 'average';
	if (l.startsWith('D')) return 'below';
	if (l.startsWith('F') || l === 'FAIL') return 'failing';
	if (l === 'PASS') return 'good';
	return 'other';
}

// ═══════════════════════════════════════════════════════════
// ── Natural Language Search Feature ──
// ═══════════════════════════════════════════════════════════

function parseNaturalQuery(queryText) {
	const query = queryText.toLowerCase();
	const result = {
		days: [],
		timeRange: { start: null, end: null },
		difficulty: null,
		departments: [],
		level: null,
		keywords: [],
		exactCourseCode: null
	};

	// Difficulty
	if (/\b(easy|easier|chill|relaxed)\b/.test(query)) result.difficulty = 'easy';
	else if (/\b(hard|difficult|tough|challenging)\b/.test(query)) result.difficulty = 'hard';
	else if (/\b(moderate|medium|average)\b/.test(query)) result.difficulty = 'moderate';

	// Exact course code (e.g., CMPSC 130A, MATH 2A)
	// Reject common English words that look like dept codes (AFTER, BEFORE, UPPER, etc.)
	const nonDeptWords = new Set(['AFTER', 'BEFORE', 'UPPER', 'LOWER', 'ABOUT', 'ABOVE', 'BELOW', 'BETWEEN', 'CLASS', 'EASY', 'HARD', 'WITH', 'FROM', 'INTO', 'OVER', 'UNDER', 'NEAR', 'LIKE', 'JUST', 'ALSO', 'SOME', 'MOST', 'THAT', 'THIS', 'THAN', 'THEN', 'VERY', 'MUCH', 'MORE', 'LESS', 'ONLY']);
	const courseCodeMatch = queryText.match(/\b([A-Z]{2,8})\s+(\d+[A-Z]*)\b/i);
	if (courseCodeMatch && !nonDeptWords.has(courseCodeMatch[1].toUpperCase())) {
		result.exactCourseCode = `${courseCodeMatch[1].toUpperCase()} ${courseCodeMatch[2].toUpperCase()}`;
	}

	// Day detection
	const dayMap = {
		'monday': 'M', 'mon': 'M',
		'tuesday': 'T', 'tue': 'T', 'tues': 'T',
		'wednesday': 'W', 'wed': 'W',
		'thursday': 'R', 'thur': 'R', 'thurs': 'R', 'thu': 'R',
		'friday': 'F', 'fri': 'F',
		'mwf': 'MWF', 'tr': 'TR', 'mw': 'MW'
	};
	for (const [word, code] of Object.entries(dayMap)) {
		if (new RegExp(`\\b${word}\\b`).test(query)) {
			for (const c of code) if (!result.days.includes(c)) result.days.push(c);
		}
	}

	// Time detection
	if (/\bmorning\b/.test(query)) { result.timeRange.start = 0; result.timeRange.end = 12; }
	else if (/\bafternoon\b/.test(query)) { result.timeRange.start = 12; result.timeRange.end = 17; }
	else if (/\bevening\b/.test(query)) { result.timeRange.start = 17; result.timeRange.end = 23; }

	const afterMatch = query.match(/after\s+(\d{1,2})\s*(am|pm)?/i);
	if (afterMatch) {
		let h = parseInt(afterMatch[1], 10);
		if (afterMatch[2] && afterMatch[2].toLowerCase() === 'pm' && h < 12) h += 12;
		result.timeRange.start = h;
	}
	const beforeMatch = query.match(/before\s+(\d{1,2})\s*(am|pm)?/i);
	if (beforeMatch) {
		let h = parseInt(beforeMatch[1], 10);
		if (beforeMatch[2] && beforeMatch[2].toLowerCase() === 'pm' && h < 12) h += 12;
		result.timeRange.end = h;
	}

	// Also match standalone time patterns like "2pm", "10am", "3:30pm"
	const standaloneTime = query.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
	if (standaloneTime && result.timeRange.start === null && result.timeRange.end === null) {
		let h = parseInt(standaloneTime[1], 10);
		if (standaloneTime[3].toLowerCase() === 'pm' && h < 12) h += 12;
		if (standaloneTime[3].toLowerCase() === 'am' && h === 12) h = 0;
		// If query has "after", treat as start; if "before", treat as end; otherwise treat as approximate
		if (/after/i.test(query)) result.timeRange.start = h;
		else if (/before/i.test(query)) result.timeRange.end = h;
		else { result.timeRange.start = h > 0 ? h - 1 : 0; result.timeRange.end = h + 2; }
	}

	// Known department codes at UCSB (used to validate uppercase matches)
	const knownDepts = new Set([
		'AM', 'ANTH', 'ART', 'ARTHI', 'BIOE', 'BIOL', 'BMSE', 'BL ST', 'CH ST',
		'CHEM', 'CHIN', 'CLASS', 'CMPSC', 'CMPEN', 'CNCSP', 'COMM', 'COMPL',
		'CS', 'DANCE', 'DYNS', 'EACS', 'EARTH', 'ECE', 'ECON', 'ED', 'EEMB',
		'ENGL', 'ENGR', 'ENV S', 'ESM', 'ESS', 'FEMST', 'FILMD', 'FR', 'GEOG',
		'GER', 'GLOBL', 'GPS', 'GRAD', 'GREEK', 'HIST', 'INT', 'ITALY', 'JAPAN',
		'KOR', 'LATIN', 'LAIS', 'LING', 'MARSC', 'MATRL', 'MATH', 'MCDB', 'ME',
		'MES', 'MILSCI', 'MUS', 'PHIL', 'PHYS', 'POL S', 'PORT', 'PSY', 'PSTAT',
		'RG ST', 'RENST', 'SLAV', 'SOC', 'SPAN', 'SHS', 'TMP', 'THTR', 'WRIT'
	]);

	// Department aliases (lowercase typed words -> canonical dept code(s))
	// Some aliases map to multiple departments using arrays
	const deptAliases = {
		'cs': 'CMPSC', 'cmpsc': 'CMPSC', 'compsci': 'CMPSC', 'computer science': 'CMPSC', 'computer': 'CMPSC',
		'compeng': 'ECE',
		'ee': 'ECE', 'ece': 'ECE', 'matsci': 'MATRL',
		'econ': 'ECON', 'economics': 'ECON',
		'math': 'MATH', 'mathematics': 'MATH',
		'bio': ['EEMB', 'MCDB', 'BIOE'], 'biology': ['EEMB', 'MCDB', 'BIOE'],
		'biolo': ['EEMB', 'MCDB', 'BIOE'], 'biol': ['EEMB', 'MCDB', 'BIOE'],
		'biological': ['EEMB', 'MCDB', 'BIOE'],
		'eemb': 'EEMB', 'ecology': 'EEMB', 'evolution': 'EEMB',
		'mcdb': 'MCDB', 'molecular': 'MCDB', 'cell': 'MCDB',
		'bioe': 'BIOE', 'bioengineering': 'BIOE',
		'chem': 'CHEM', 'chemistry': 'CHEM',
		'phys': 'PHYS', 'physics': 'PHYS',
		'psych': 'PSY', 'psy': 'PSY', 'psychology': 'PSY',
		'stats': 'PSTAT', 'statistics': 'PSTAT', 'pstat': 'PSTAT',
		'comm': 'COMM', 'communication': 'COMM',
		'art': 'ART', 'music': 'MUS', 'mus': 'MUS',
		'hist': 'HIST', 'history': 'HIST',
		'eng': 'ENGL', 'engl': 'ENGL', 'english': 'ENGL',
		'phil': 'PHIL', 'philosophy': 'PHIL',
		'soc': 'SOC', 'sociology': 'SOC',
		'anth': 'ANTH', 'anthropology': 'ANTH',
		'geog': 'GEOG', 'geography': 'GEOG',
		'ling': 'LING', 'linguistics': 'LING',
		'span': 'SPAN', 'spanish': 'SPAN',
		'french': 'FR', 'fr': 'FR',
		'german': 'GER', 'ger': 'GER',
		'japan': 'JAPAN', 'japanese': 'JAPAN',
		'chin': 'CHIN', 'chinese': 'CHIN',
		'dance': 'DANCE', 'theatre': 'THTR', 'theater': 'THTR', 'thtr': 'THTR',
		'writing': 'WRIT', 'writ': 'WRIT',
		'earth': 'EARTH', 'geology': 'EARTH',
		'polisci': 'POL S', 'political science': 'POL S', 'poli sci': 'POL S',
		'environ': 'ENV S', 'environmental': 'ENV S',
		'feminist': 'FEMST', 'femst': 'FEMST', 'film': 'FILMD',
		'electrical': 'ECE',
		'am': 'AM', 'applied math': 'AM', 'applied mathematics': 'AM',
		'engr': 'ENGR', 'engineering': 'ENGR',
		'globl': 'GLOBL', 'global': 'GLOBL',
		'me': 'ME'
	};

	// Extract uppercase dept codes from query text — but only if they are known departments
	const deptPattern = /\b([A-Z]{2,8})\b/g;
	let dm;
	while ((dm = deptPattern.exec(queryText)) !== null) {
		if (knownDepts.has(dm[1]) && !result.departments.includes(dm[1])) {
			result.departments.push(dm[1]);
		}
	}
	// Also check for department aliases in lowercase query
	for (const [alias, dept] of Object.entries(deptAliases)) {
		if (new RegExp(`\\b${alias}\\b`).test(query)) {
			const depts = Array.isArray(dept) ? dept : [dept];
			for (const d of depts) {
				if (!result.departments.includes(d)) result.departments.push(d);
			}
		}
	}

	// Course level
	if (/\bupper\s*div/i.test(query)) result.level = 'upper';
	else if (/\blower\s*div/i.test(query)) result.level = 'lower';

	return result;
}

function filterCoursesNLP(query, courseLookup, deptAverages) {
	if (!courseLookup) return [];
	const parsed = parseNaturalQuery(query);
	const results = [];
	const queryLower = query.toLowerCase().trim();
	const queryWords = queryLower.split(/\s+/).filter(w => w.length >= 2);
	
	// Check if we have any meaningful structured filters
	const hasDeptFilter = parsed.departments.length > 0;
	const hasExactCourse = !!parsed.exactCourseCode;
	const hasDifficulty = !!parsed.difficulty;
	const hasLevel = !!parsed.level;
	const hasDays = parsed.days.length > 0;
	const hasTime = parsed.timeRange.start !== null || parsed.timeRange.end !== null;
	const hasStructuredFilter = hasDeptFilter || hasExactCourse || hasDifficulty || hasLevel || hasDays || hasTime;
	
	// If no structured filter matched, try keyword/substring matching against course names,
	// professor names, and department names
	const doKeywordSearch = !hasStructuredFilter && queryWords.length > 0;

	// Pre-build a DOM day/time index for the current page so we can score schedule matches.
	// Maps normalized course code → [{ days: string, startHour: number }]
	const pageSections = (hasDays || hasTime) ? buildPageScheduleIndex() : null;

	for (const [courseName, records] of courseLookup.entries()) {
		for (const rec of records) {
			let score = 0;
			let excluded = false;

			// Exact course code — strongest match (weight: 100)
			if (hasExactCourse) {
				const normTarget = normalizeCourseCode(parsed.exactCourseCode);
				if (normalizeCourseCode(rec.courseName) === normTarget) score += 100;
				else { excluded = true; }
			}

			// Department filter — high weight (50) so it always dominates difficulty/level
			if (!excluded && hasDeptFilter) {
				const dept = (rec.courseName || '').split(/\s+/)[0];
				if (parsed.departments.includes(dept)) score += 50;
				else if (!hasExactCourse) { excluded = true; }
			}

			if (excluded) continue;
			
			// If no dept and no exact code, give a small base score so difficulty/level filters work
			if (hasStructuredFilter && !hasDeptFilter && !hasExactCourse) {
				score += 1;
			}

			// Keyword/substring search — matches course names and professor names
			if (doKeywordSearch) {
				const courseNameLower = (rec.courseName || '').toLowerCase();
				const profLower = (rec.csvProfessor || '').toLowerCase();
				const combined = courseNameLower + ' ' + profLower;
				
				let keywordScore = 0;
				for (const word of queryWords) {
					// Skip common filler words
					if (/^(the|a|an|in|on|at|for|and|or|with|my|is|are|class|classes|course|courses)$/.test(word)) continue;
					if (combined.includes(word)) keywordScore += 5;
					else if (courseNameLower.includes(word)) keywordScore += 5;
					else if (profLower.includes(word)) keywordScore += 8; // professor match is strong
				}
				
				if (keywordScore > 0) {
					score += keywordScore;
				} else {
					// No keyword matched — skip this record
					continue;
				}
			}

			// Difficulty — secondary modifier (weight: 5), never overrides dept/course
			const gpa = parseFloat(rec.avgGpa);
			if (hasDifficulty && !isNaN(gpa)) {
				if (parsed.difficulty === 'easy' && gpa >= 3.5) score += 5;
				else if (parsed.difficulty === 'hard' && gpa <= 2.8) score += 5;
				else if (parsed.difficulty === 'moderate' && gpa > 2.8 && gpa < 3.5) score += 5;
				else score -= 2;
			}

			// Course level — secondary modifier (weight: 3)
			const numMatch = (rec.courseName || '').match(/\d+/);
			const courseNum = numMatch ? parseInt(numMatch[0], 10) : 0;
			if (hasLevel) {
				if (parsed.level === 'upper' && courseNum >= 100) score += 3;
				else if (parsed.level === 'lower' && courseNum < 100) score += 3;
				else if (courseNum > 0) score -= 1;
			}

			// Day/time — low-weight tiebreaker (weight: 2 each)
			// Checks the visible GOLD page for schedule rows matching this course
			if (pageSections && (hasDays || hasTime)) {
				const normCode = normalizeCourseCode(rec.courseName);
				const sections = pageSections.get(normCode);
				if (sections && sections.length > 0) {
					let dayMatch = false;
					let timeMatch = false;
					for (const sec of sections) {
						if (hasDays && sec.days) {
							const sectionDays = sec.days.toUpperCase();
							if (parsed.days.every(d => sectionDays.includes(d))) dayMatch = true;
						}
						if (hasTime && sec.startHour !== null) {
							const afterOk = parsed.timeRange.start === null || sec.startHour >= parsed.timeRange.start;
							const beforeOk = parsed.timeRange.end === null || sec.startHour < parsed.timeRange.end;
							if (afterOk && beforeOk) timeMatch = true;
						}
					}
					if (hasDays) score += dayMatch ? 2 : -1;
					if (hasTime) score += timeMatch ? 2 : -1;
				}
				// If no sections found on the page for this course, don't penalise —
				// the course may still be relevant even if not on the current page.
			}

			if (score > 0) {
				// Compute grade inflation index vs dept average
				const dept = (rec.courseName || '').split(/\s+/)[0];
				const deptAvg = deptAverages && deptAverages.get ? deptAverages.get(dept) : null;
				let inflationDelta = null;
				if (!isNaN(gpa) && deptAvg && !isNaN(deptAvg)) {
					inflationDelta = +(gpa - deptAvg).toFixed(2);
				}
				results.push({ course: rec, score, inflationDelta });
			}
		}
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, 20);
}

function computeDeptAverages(courseLookup) {
	if (!courseLookup) return new Map();
	const sums = new Map();
	for (const [, records] of courseLookup.entries()) {
		for (const rec of records) {
			const dept = (rec.courseName || '').split(/\s+/)[0];
			const gpa = parseFloat(rec.avgGpa);
			if (!dept || isNaN(gpa)) continue;
			const entry = sums.get(dept) || { total: 0, count: 0 };
			entry.total += gpa;
			entry.count += 1;
			sums.set(dept, entry);
		}
	}
	const avgs = new Map();
	for (const [dept, { total, count }] of sums.entries()) {
		if (count > 0) avgs.set(dept, total / count);
	}
	return avgs;
}

async function renderNLPSearchBar() {
	// Avoid duplicate
	if (document.querySelector('.rmg-nlp-search')) return;

	const courseLookup = await ensureCoursesLoaded();
	if (!courseLookup) return;

	const deptAverages = computeDeptAverages(courseLookup);

	// Build UI
	const container = document.createElement('div');
	container.className = 'rmg-nlp-search';

	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'rmg-nlp-input';
	input.placeholder = "Try: 'Easy CMPSC classes on MWF mornings'";

	const resultsPanel = document.createElement('div');
	resultsPanel.className = 'rmg-nlp-results';
	resultsPanel.style.display = 'none';

	container.appendChild(input);
	container.appendChild(resultsPanel);
	document.body.appendChild(container);

	let debounceTimer = null;

	input.addEventListener('input', () => {
		clearTimeout(debounceTimer);
		const q = input.value.trim();
		if (q.length < 3) { resultsPanel.style.display = 'none'; return; }
		debounceTimer = setTimeout(() => {
			const matches = filterCoursesNLP(q, courseLookup, deptAverages);
			renderResults(matches);
		}, 250);
	});

	// Close on outside click
	document.addEventListener('click', (e) => {
		if (!container.contains(e.target)) resultsPanel.style.display = 'none';
	});

	function renderResults(matches) {
		resultsPanel.innerHTML = '';
		if (matches.length === 0) {
			const noRes = document.createElement('div');
			noRes.className = 'rmg-nlp-no-results';
			noRes.textContent = 'No matching courses found.';
			resultsPanel.appendChild(noRes);
			resultsPanel.style.display = 'block';
			return;
		}

		for (const result of matches) {
			const item = document.createElement('div');
			item.className = 'rmg-nlp-result-item';

			const code = document.createElement('span');
			code.className = 'rmg-nlp-result-code';
			code.textContent = result.course.courseName || '';

			const prof = document.createElement('span');
			prof.className = 'rmg-nlp-result-prof';
			prof.textContent = result.course.csvProfessor ? `Professor: ${result.course.csvProfessor}` : '';

			const gpa = document.createElement('span');
			gpa.className = 'rmg-nlp-result-gpa';
			const avgGpa = parseFloat(result.course.avgGpa);
			gpa.textContent = !isNaN(avgGpa) ? `Avg GPA: ${avgGpa.toFixed(2)}` : '';

			item.appendChild(code);
			item.appendChild(prof);
			item.appendChild(gpa);

			// Grade inflation chip
			if (result.inflationDelta !== null) {
				const chip = document.createElement('span');
				chip.className = 'rmg-nlp-result-inflation';
				if (result.inflationDelta > 0.15) {
					chip.textContent = `+${result.inflationDelta.toFixed(2)} GPA (Easier than avg)`;
					chip.classList.add('rmg-grade-inflation--easier');
				} else if (result.inflationDelta < -0.15) {
					chip.textContent = `${result.inflationDelta.toFixed(2)} GPA (Harder than avg)`;
					chip.classList.add('rmg-grade-inflation--harder');
				} else {
					chip.textContent = '(Near dept avg)';
					chip.classList.add('rmg-grade-inflation--near');
				}
				chip.style.whiteSpace = 'nowrap';
				chip.style.flexShrink = '0';
				item.appendChild(chip);
			}

			// Click handler: scroll to the course on the page
			item.addEventListener('click', () => {
				const courseName = result.course.courseName || '';
				const target = findCourseRowInDOM(courseName);
				if (target) {
					scrollToAndFlash(target);
				} else {
					console.warn('[RateMyGaucho] Could not find DOM element for course:', courseName);
					// Visual feedback that it wasn't found on this page
					item.style.background = '#fff0f0';
					setTimeout(() => { item.style.background = ''; }, 800);
				}
				resultsPanel.style.display = 'none';
			});

			resultsPanel.appendChild(item);
		}
		resultsPanel.style.display = 'block';
	}
}
