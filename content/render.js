// Builds the rating card shown under each course.

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
