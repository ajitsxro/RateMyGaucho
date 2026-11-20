// Loads and parses the bundled CSV data.

let __rmg_lookup = null;
let __rmg_loading = null;
let __rmg_course_lookup = null;
let __rmg_course_loading = null;

async function ensureRatingsLoaded() {
	if (__rmg_lookup) return __rmg_lookup;
	if (__rmg_loading) return __rmg_loading;
	__rmg_loading = (async () => {
		try {
			const csvUrl = chrome.runtime.getURL('scores.csv');
			const res = await fetch(csvUrl);
			if (!res.ok) return null;
			const csvText = await res.text();
			if (!csvText || csvText.trim().length < 10) return null;
			const records = parseCsv(csvText);
			__rmg_lookup = buildLookup(records);
			return __rmg_lookup;
		} catch (_e) {
			return null;
		} finally {
			__rmg_loading = null;
		}
	})();
	return __rmg_loading;
}

async function ensureCoursesLoaded() {
	if (__rmg_course_lookup) return __rmg_course_lookup;
	if (__rmg_course_loading) return __rmg_course_loading;
	__rmg_course_loading = (async () => {
		try {
			// Use the actual bundled CSV file
			const primaryUrl = chrome.runtime.getURL('courses_final_enrollment.csv');
			
			let csvText = null;
			
			try {
				const res = await fetch(primaryUrl);
				if (res.ok) {
					csvText = await res.text();
				}
			} catch (primaryError) {
				console.warn('[RateMyGaucho] Failed to load courses_final_enrollment.csv:', primaryError);
			}
			
			if (csvText == null) {
				console.error('[RateMyGaucho] Failed to load course data — no CSV file available');
				return null;
			}
			
			const records = parseCourseCsv(csvText);
			__rmg_course_lookup = buildCourseLookup(records);
			// Store globally for extractCourseCode validation
			window.__rmg_course_lookup = __rmg_course_lookup;
			return __rmg_course_lookup;
		} catch (_e) {
			console.error('[RateMyGaucho] Error loading course data:', _e);
			return null;
		} finally {
			__rmg_course_loading = null;
		}
	})();
	return __rmg_course_loading;
}

function parseCsv(csvText) {
	const lines = csvText.split(/\r?\n/).filter(Boolean);
	if (!lines.length) return [];
	lines.shift();
	const out = [];
	for (const line of lines) {
		const cols = line.split(',');
		if (cols.length < 6) continue;
		const [department, first_name, last_name, rmp_score, num_reviews, profile_url] = cols;
		const rec = {
			department: (department||'').trim(),
			firstName: (first_name||'').trim(),
			lastName: (last_name||'').trim(),
			rmpScore: Number(rmp_score),
			numReviews: Number(num_reviews),
			profileUrl: (profile_url||'').trim()
		};
		if (!Number.isFinite(rec.rmpScore) || !Number.isFinite(rec.numReviews)) continue;
		out.push(rec);
	}
	return out;
}

/**
 * Compute a weighted GPA from a grading trend string like "A: 62.6%, B: 27.8%, C: 9.1%, D: 0.0%, F: 0.5%"
 * Returns NaN if not parseable (e.g. Pass/Fail courses).
 */
function computeGpaFromGradingTrend(trend) {
	if (!trend) return NaN;
	const gradePoints = { 'A': 4.0, 'B': 3.0, 'C': 2.0, 'D': 1.0, 'F': 0.0 };
	let totalWeight = 0;
	let totalPoints = 0;
	for (const [letter, points] of Object.entries(gradePoints)) {
		const regex = new RegExp(`${letter}[+-]?\\s*:\\s*([\\d.]+)%`, 'i');
		const m = trend.match(regex);
		if (m) {
			const pct = parseFloat(m[1]);
			if (!isNaN(pct)) {
				totalWeight += pct;
				totalPoints += pct * points;
			}
		}
	}
	if (totalWeight < 10) return NaN; // Not enough data (probably Pass/Fail)
	return totalPoints / totalWeight;
}

function parseCourseCsv(csvText) {
	try {
		const parsed = Papa.parse(csvText, {
			header: true,
			skipEmptyLines: true,
			transformHeader: (header) => header.trim()
		});
		
		if (parsed.errors.length > 0) {
			console.warn('[RateMyGaucho] CSV parsing warnings:', parsed.errors);
		}
		
		const out = [];
		for (const row of parsed.data) {
			if (!row.course_name) continue;
			
			// Build recentReviews from individual review_1/2/3 columns OR legacy recent_reviews
			let recentReviews;
			if (row.review_1 || row.review_2 || row.review_3) {
				recentReviews = [row.review_1, row.review_2, row.review_3]
					.map(r => (r || '').trim())
					.filter(Boolean);
			} else {
				recentReviews = parseFlexibleArray(row.recent_reviews, { reviewSeparator: '|||', type: 'string' });
			}
			
			// Compute avgGpa from grading_trend (e.g. "A: 62.6%, B: 27.8%, C: 9.1%, D: 0.0%, F: 0.5%")
			let avgGpa = row.avg_gpa ? parseFloat(row.avg_gpa) : NaN;
			if (isNaN(avgGpa)) {
				avgGpa = computeGpaFromGradingTrend(row.grading_trend || '');
			}

			// Parse grading trend into individual grade entries for pills
			const gradingTrendRaw = (row.grading_trend || '').trim();
			let gradingTrend = [];
			if (gradingTrendRaw) {
				// Format: "A: 62.6%, B: 27.8%, C: 9.1%, D: 0.0%, F: 0.5%"
				const gradeMatches = gradingTrendRaw.match(/[A-Za-z+\-]+\s*:\s*[\d.]+%/g);
				if (gradeMatches) {
					gradingTrend = gradeMatches.map(g => g.trim());
				} else {
					gradingTrend = [gradingTrendRaw]; // fallback: single entry
				}
			}

			// Parse enrollment trend: extract current/max numbers from pipe-separated entries
			const enrollmentRaw = (row.enrollment_trend || '').trim();
			let enrollmentTrend = [];
			if (enrollmentRaw) {
				const entries = enrollmentRaw.split('|').map(e => e.trim()).filter(Boolean);
				for (const entry of entries) {
					// Match pattern like "22/210" or "0/360"
					const m = entry.match(/(\d+)\s*\/\s*(\d+)/);
					if (m) {
						enrollmentTrend.push(parseInt(m[1], 10));
					}
				}
			}
			
			const rec = {
				// Existing fields used by the UI and matching
				courseName: (row.course_name || '').trim(),
				courseUrl: (row.course_url || '').trim(),
				
				// Keep compatibility: some CSVs may not have grading_basis
				gradingBasis: (row.grading_basis || '').trim(),
				
				// Parsed grading and enrollment data for visual display
				gradingTrend: gradingTrend,
				enrollmentTrend: enrollmentTrend,
				recentReviews,
				
				// Professor and metadata
				csvProfessor: (row.professor || '').trim(),
				expectedReviews: row.expected_reviews ? Number(row.expected_reviews) : undefined,
				foundReviews: row.found_reviews ? Number(row.found_reviews) : undefined,
				reviewVerification: (row.review_verification || '').trim(),
				
				// Computed GPA for NLP search
				avgGpa: isNaN(avgGpa) ? undefined : avgGpa
			};
			
			out.push(rec);
		}
		return out;
	} catch (e) {
		console.error('[RateMyGaucho] Error parsing course CSV:', e);
		return [];
	}
}

function parseFlexibleArray(raw, { delimiter = '|', type = 'string', reviewSeparator = null } = {}) {
	if (!raw || String(raw).trim() === '' || String(raw).toLowerCase() === 'no data') return [];
	const text = String(raw).trim();

	// 1) Try JSON first for backward compatibility (handles legacy format)
	if (text.startsWith('[') && text.endsWith(']')) {
		try {
			const parsed = JSON.parse(text);
			if (Array.isArray(parsed)) {
				return type === 'number' ? parsed.map(v => Number(v)).filter(n => Number.isFinite(n)) : parsed.map(v => String(v));
			}
		} catch {
			// not JSON, fall through to delimiter parsing
		}
	}

	// 2) If a review separator is provided, use that (e.g., "|||" for reviews)
	if (reviewSeparator && text.includes(reviewSeparator)) {
		return text.split(reviewSeparator).map(s => s.trim()).filter(Boolean);
	}

	// 3) Otherwise, split on delimiter (e.g., pipes for trends)
	if (delimiter && text.includes(delimiter)) {
		const parts = text.split(delimiter).map(s => s.trim()).filter(Boolean);
		return type === 'number' ? parts.map(v => Number(v)).filter(n => Number.isFinite(n)) : parts;
	}

	// 4) Fallback: single token
	if (type === 'number') {
		const num = Number(text);
		return Number.isFinite(num) ? [num] : [];
	}
	return [text];
}

function buildCourseLookup(records) {
	const map = new Map();
	for (const rec of records) {
		const normalizedName = normalizeCourseCode(rec.courseName);
		const list = map.get(normalizedName);
		if (list) {
			list.push(rec);
		} else {
			map.set(normalizedName, [rec]);
		}
	}
	return map;
}

function normalizeCourseCode(courseCode) {
	return (courseCode || '').toUpperCase().replace(/\s+/g, ' ').trim();
}
