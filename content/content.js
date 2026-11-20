// Entry point: checks settings, then watches the page for instructor rows.

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
