// Finds instructor cells and course codes in the GOLD page.

function findInstructorNodes() {
	const set = new Set();
	// 1) Table header-based detection: find the "Instructor" column and grab its cells
	try {
		for (const table of document.querySelectorAll('table')) {
			const headerCells = Array.from(table.querySelectorAll('thead th, tr th'));
			let idx = -1;
			for (let i = 0; i < headerCells.length; i++) {
				const t = (headerCells[i].textContent || '').trim().toLowerCase();
				if (t.includes('instructor')) { idx = i; break; }
			}
			if (idx >= 0) {
				for (const row of table.querySelectorAll('tbody tr, tr')) {
					const cells = row.querySelectorAll('td');
					if (cells && cells.length > idx) {
						const cell = cells[idx];
						const txt = (cell.textContent || '').trim();
						// Skip empty cells, single-letter cells (like "W" for day),
						// and header text like "Instructor"
						if (!txt || txt.length < 2 || /^(instructor|professor|ta|staff)$/i.test(txt)) continue;
						// Must look like a name: at least 2 chars and mostly letters
						if (/^[A-Za-z][A-Za-z\s,.\-']+$/.test(txt) && txt.length >= 3) {
							set.add(cell);
						}
					}
				}
			}
		}
	} catch {}

	// 2) Attribute- and class-based selectors
	const selectors = [
		'[headers*="Instructor" i]',
		'td[aria-label*="Instructor" i]',
		"td:has(> span[title*='Instructor' i])",
		'.instructor, .professor, .instructorName'
	];
	for (const sel of selectors) { for (const el of document.querySelectorAll(sel)) set.add(el); }

	// 2.5) Label-based detection: rows/cols where a label contains "Instructor"; use the nearest text span
	try {
		for (const label of document.querySelectorAll('label')) {
			const lt = (label.textContent || '').trim().toLowerCase();
			if (!lt || !lt.includes('instructor')) continue;
			const container = label.parentElement || label.closest('div');
			if (!container) continue;
			const candidate = container.querySelector('span, div');
			if (candidate) set.add(candidate);
		}
	} catch {}

	// 3) Heuristic: rows that contain an "Add" button/link likely belong to course result rows
	const addButtons = Array.from(document.querySelectorAll('a,button,input'))
		.filter(el => /add/i.test((el.textContent || el.value || '').trim()));
	for (const btn of addButtons) {
		const row = btn.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow') || btn.parentElement;
		if (!row) continue;
		let best = null, bestScore = 0;
		for (const cell of row.querySelectorAll('td,div,span')) {
			const txt = (cell.textContent || '').trim().replace(/\s+/g, ' ');
			if (!txt) continue;
			const s = nameScore(txt);
			if (s > bestScore) { best = cell; bestScore = s; }
		}
		if (best && bestScore >= 2) set.add(best);
	}

	// 4) Fallback: scan all cells for name-like text but only keep those inside rows that also have an Add control
	try {
		for (const cell of document.querySelectorAll('td, span, div')) {
			const txt = (cell.textContent || '').trim().replace(/\s+/g, ' ');
			if (!txt) continue;
			const score = nameScore(txt);
			if (score >= 3) { // Lowered threshold from 4 to 3
				const row = cell.closest && cell.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow');
				if (!row) continue;
				const hasAdd = !!Array.from(row.querySelectorAll('a,button,input')).find(el => /add/i.test((el.textContent || el.value || '').trim()));
				if (hasAdd) set.add(cell);
			}
		}
	} catch {}

	// 5) Additional detection: Look for cells that contain common instructor name patterns
	try {
		for (const cell of document.querySelectorAll('td, span, div')) {
			const txt = (cell.textContent || '').trim().replace(/\s+/g, ' ');
			if (!txt) continue;
			
			// Look for patterns like "LAST F", "LAST F M", "FIRST LAST", etc.
			if (/^[A-Z][A-Z'\-]+\s+[A-Z](?:\s+[A-Z])?$/.test(txt) || // LAST F or LAST F M
				/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(txt) || // First Last
				/^[A-Z][A-Z'\-]+,\s*[A-Z]/.test(txt)) { // LAST, F
				
				const row = cell.closest && cell.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow');
				if (row) {
					// Check if this row has course-related elements
					const hasCourseElements = !!Array.from(row.querySelectorAll('a,button,input')).find(el => 
						/(add|course|info|final|save|cart)/i.test((el.textContent || el.value || '').trim())
					);
					if (hasCourseElements) set.add(cell);
				}
			}
		}
	} catch {}

	return Array.from(set);
}

function nameScore(txt) {
	const clean = txt.trim().replace(/\s+/g, ' ');
	if (!clean) return 0;
	// Immediately reject obvious non-name cells
	if (/(Space|Max|Units|Building|Hall|Room|Course|Info|Final|Save|Cart|Closed|Open|Time|Days|Section)/i.test(clean)) return 0;
	if (/\d{2,}/.test(clean)) return 0;
	const words = clean.split(' ').filter(Boolean);
	let score = 0;
	
	// "Last, First" pattern
	if (/,\s*[A-Za-z]/.test(clean)) score += 3;
	
	// "First Last" (require at least two words)
	if (words.length >= 2 && /^[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3}$/.test(clean)) score += 3;
	
	// "LAST I N" pattern (all caps last + initials)
	if (/^[A-Z][A-Z'\-]+(?:\s+[A-Z](?:\.|\b)){1,3}$/.test(clean)) score += 3;
	
	// "LAST F" pattern (all caps last + single initial)
	if (/^[A-Z][A-Z'\-]+\s+[A-Z]$/.test(clean)) score += 2;
	
	// Mixed case patterns like "Last F" or "First Last"
	if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(clean)) score += 2;
	if (/^[A-Z][A-Z'\-]+\s+[A-Z][a-z]+$/.test(clean)) score += 2;
	
	// Bonus for presence of initials tokens
	if (words.some(w => w.length === 1 || /\.$/.test(w))) score += 1;
	
	// Reasonable length
	if (clean.length <= 40) score += 1;
	
	// Bonus for common name patterns
	if (/^[A-Z][a-z]+\s+[A-Z]\.?\s*[A-Z][a-z]+$/.test(clean)) score += 1; // First M. Last
	
	return score;
}

function extractCourseCode(instructorNode) {
	// Helper function to find valid course codes in text
	function findValidCourseCodeInText(text, courseLookup) {
		const normalizedText = text.trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
		// Find all potential course code candidates
		const matches = normalizedText.matchAll(/\b([A-Z]{2,8})\s+(\d{1,3}[A-Z]*)\b/g);
		for (const match of matches) {
			const candidate = `${match[1]} ${match[2]}`;
			const normalized = normalizeCourseCode(candidate);
			if (courseLookup && courseLookup.has(normalized)) {
				return candidate;
			}
		}
		return null;
	}

	try {
		// Find the containing row
		const row = instructorNode.closest('tr, .row, .resultsRow, .SSR_CLSRSLT_WRK, .sectionRow, .CourseRow');
		if (!row) return null;
		
		// First, try the same row (current logic) - expanded to include anchors and headers
		const cells = Array.from(row.querySelectorAll('td, th, div, span, a, strong, b'));
		for (const cell of cells) {
			if (cell === instructorNode || cell.contains(instructorNode)) continue;
			
			const text = (cell.textContent || '').trim();
			const courseCode = findValidCourseCodeInText(text, window.__rmg_course_lookup);
			if (courseCode) {
				return courseCode;
			}
		}
		
		// If not found in same row, search previous sibling rows (likely header rows) - expanded depth and nodes
		let prevRow = row.previousElementSibling;
		for (let i = 0; prevRow && i < 30; i++) {
			const prevCells = Array.from(prevRow.querySelectorAll('td, th, div, span, a, strong, b'));
			for (const cell of prevCells) {
				const text = (cell.textContent || '').trim();
				const courseCode = findValidCourseCodeInText(text, window.__rmg_course_lookup);
				if (courseCode) {
					return courseCode;
				}
			}
			prevRow = prevRow.previousElementSibling;
		}
		
		// Ancestor walk: search outside the table by climbing ancestors and scanning their previous siblings
		let container = row.parentElement;
		for (let up = 0; container && up < 5; up++) {
			let prev = container.previousElementSibling;
			for (let j = 0; prev && j < 30; j++) {
				const text = (prev.textContent || '').trim();
				const courseCode = findValidCourseCodeInText(text, window.__rmg_course_lookup);
				if (courseCode) {
					return courseCode;
				}
				prev = prev.previousElementSibling;
			}
			container = container.parentElement;
		}
		
		// Final fallback: search the entire table for course headers
		const table = instructorNode.closest('table');
		if (table) {
			const allRows = Array.from(table.querySelectorAll('tr'));
			const currentRowIndex = allRows.indexOf(row);
			
			// Search backwards from current row
			for (let i = currentRowIndex - 1; i >= 0 && i >= currentRowIndex - 10; i--) {
				const searchRow = allRows[i];
				const searchCells = Array.from(searchRow.querySelectorAll('td, th, div, span, a, strong, b'));
				
				for (const cell of searchCells) {
					const text = (cell.textContent || '').trim();
					const courseCode = findValidCourseCodeInText(text, window.__rmg_course_lookup);
					if (courseCode) {
						return courseCode;
					}
				}
			}
		}
		
		// Heuristic fallback: try to extract from "Course Info" button href or onclick
		try {
			const courseInfoButtons = Array.from(row.querySelectorAll('a, button')).filter(el => 
				/course\s*info/i.test((el.textContent || '').trim())
			);
			
			for (const btn of courseInfoButtons) {
				// Try href first
				if (btn.href) {
					const hrefMatch = btn.href.match(/subject=([A-Z]+).*?catalogNbr=(\d+[A-Z]*)/i);
					if (hrefMatch) {
						const candidate = `${hrefMatch[1]} ${hrefMatch[2]}`;
						const normalized = normalizeCourseCode(candidate);
						if (window.__rmg_course_lookup && window.__rmg_course_lookup.has(normalized)) {
							return candidate;
						}
					}
				}
				
				// Try onclick attribute
				const onclick = btn.getAttribute('onclick');
				if (onclick) {
					const onclickMatch = onclick.match(/subject['"]\s*:\s*['"]([A-Z]+)['"].*?catalogNbr['"]\s*:\s*['"](\d+[A-Z]*)['"]/i);
					if (onclickMatch) {
						const candidate = `${onclickMatch[1]} ${onclickMatch[2]}`;
						const normalized = normalizeCourseCode(candidate);
						if (window.__rmg_course_lookup && window.__rmg_course_lookup.has(normalized)) {
							return candidate;
						}
					}
				}
			}
		} catch (e) {
			console.warn('[RateMyGaucho] Error in Course Info button extraction:', e);
		}
		
		return null;
	} catch (e) {
		console.warn('[RateMyGaucho] Error extracting course code:', e);
		return null;
	}
}

/**
 * Build a schedule index from the current GOLD page DOM.
 * Scans visible table rows for course codes, day patterns (M, T, W, R, F, TR, MWF, etc.)
 * and start times. Returns Map<normalizedCourseCode, [{days, startHour}]>.
 */
function buildPageScheduleIndex() {
	const index = new Map();
	const courseCodeRe = /\b([A-Z]{2,8})\s+(\d{1,3}[A-Z]*)\b/;
	const dayRe = /\b([MTWRF]{1,5})\b/;
	const timeRe = /(\d{1,2}):(\d{2})\s*(AM|PM)/i;

	let currentCourse = null;
	for (const row of document.querySelectorAll('tr')) {
		const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
		// Detect course header rows
		const cm = text.match(courseCodeRe);
		if (cm) {
			currentCourse = normalizeCourseCode(`${cm[1]} ${cm[2]}`);
		}
		if (!currentCourse) continue;

		// Look for day and time in this row's cells
		const cells = row.querySelectorAll('td, th');
		let days = null;
		let startHour = null;
		for (const cell of cells) {
			const ct = (cell.textContent || '').trim();
			if (!days) {
				const dm = ct.match(dayRe);
				if (dm && /^[MTWRF]+$/.test(dm[1])) days = dm[1];
			}
			if (startHour === null) {
				const tm = ct.match(timeRe);
				if (tm) {
					let h = parseInt(tm[1], 10);
					const period = tm[3].toUpperCase();
					if (period === 'PM' && h < 12) h += 12;
					if (period === 'AM' && h === 12) h = 0;
					startHour = h;
				}
			}
		}
		if (days || startHour !== null) {
			if (!index.has(currentCourse)) index.set(currentCourse, []);
			index.get(currentCourse).push({ days, startHour });
		}
	}
	return index;
}

/**
 * Normalize a string for loose comparison: strip non-alphanumerics, lowercase.
 */
function normalizeForComparison(str) {
	return String(str || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Find the DOM row(s) matching a course code, using multiple strategies.
 * Returns an element to scroll to, or null.
 */
function findCourseRowInDOM(courseName) {
	const normalizedTarget = normalizeForComparison(courseName);
	const courseRegex = /\b([A-Z]{2,8})\s+(\d+[A-Z]*)\b/gi;

	// Strategy 1: Look for any element whose text content matches the course code
	// after normalization (strip all non-alnum, case-insensitive)
	const allCells = document.querySelectorAll('td, th, span, div, a, strong, b');
	for (const cell of allCells) {
		const text = (cell.textContent || '').trim();
		if (!text) continue;
		// Only consider cells whose own direct text is short-ish (course title cells)
		if (text.length > 120) continue;

		const cellNorm = normalizeForComparison(text);
		if (cellNorm.includes(normalizedTarget)) {
			// Found it — prefer the closest <tr> ancestor
			const tr = cell.closest && cell.closest('tr');
			return tr || cell;
		}
	}

	// Strategy 2: Scan all <tr> rows for child text nodes matching the course regex
	const allRows = document.querySelectorAll('tr');
	for (const row of allRows) {
		const rowText = (row.textContent || '').replace(/\s+/g, ' ');
		let match;
		courseRegex.lastIndex = 0;
		while ((match = courseRegex.exec(rowText)) !== null) {
			const found = normalizeForComparison(`${match[1]} ${match[2]}`);
			if (found === normalizedTarget) return row;
		}
	}

	// Strategy 3: Broader search — any element containing the course code pattern
	const everything = document.querySelectorAll('*');
	for (const el of everything) {
		if (el.children.length > 5) continue; // skip large containers
		const t = (el.textContent || '').trim();
		if (t.length > 200) continue;
		courseRegex.lastIndex = 0;
		let m;
		while ((m = courseRegex.exec(t)) !== null) {
			if (normalizeForComparison(`${m[1]} ${m[2]}`) === normalizedTarget) {
				return el.closest('tr') || el;
			}
		}
	}

	return null;
}

/**
 * Scroll to an element with an offset (to clear fixed headers / search bar)
 * and flash-highlight it so the user can see where to look.
 */
function scrollToAndFlash(element) {
	if (!element) return;
	const rect = element.getBoundingClientRect();
	const absoluteY = rect.top + window.pageYOffset;
	window.scrollTo({ top: absoluteY - 150, behavior: 'smooth' });

	// Flash highlight
	element.classList.add('rmg-flash-highlight');
	setTimeout(() => element.classList.remove('rmg-flash-highlight'), 1800);
}
