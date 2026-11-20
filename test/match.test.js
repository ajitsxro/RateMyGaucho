const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../content/match.js');

function prof(firstName, lastName, numReviews = 1, department = '') {
	return { firstName, lastName, numReviews, department, rmpScore: 4, profileUrl: '' };
}

const PROFS = [
	prof('José', 'García', 10),
	prof('Kevin', "O'Brien", 5),
	prof('Kelvin', 'Lam', 3),
	prof('Sarah', 'Lam', 40),
	prof('Matt', 'Porter', 12),
	prof('Anna', 'Smith-Jones', 7),
	prof('James', 'Childress', 2)
];

// Runs a GOLD instructor cell's text through the same path the scanner uses.
function lookupName(text, profs = PROFS) {
	const info = m.extractInstructorInfo({ textContent: text });
	const hit = m.matchInstructor(info, m.buildLookup(profs));
	return hit ? `${hit.firstName} ${hit.lastName}` : null;
}

test('normalizeName strips accents, case and extra spaces', () => {
	assert.equal(m.normalizeName('  José   GARCÍA '), 'jose garcia');
	assert.equal(m.normalizeName('Zoë'), 'zoe');
});

test('makeKey ignores accents and only keeps the first initial', () => {
	assert.equal(m.makeKey('García', 'José', ''), m.makeKey('GARCIA', 'J', ''));
	assert.equal(m.makeKey('Lam', 'Kelvin', 'CMPSC'), 'lam|k|cmpsc');
});

test('GOLD "LAST F" format matches the CSV name', () => {
	assert.equal(lookupName('PORTER M'), 'Matt Porter');
});

test('extra middle initials are ignored', () => {
	assert.equal(lookupName('PORTER M J'), 'Matt Porter');
});

test('"First Last" format matches', () => {
	assert.equal(lookupName('Matt Porter'), 'Matt Porter');
});

test('unaccented GOLD name matches an accented CSV name', () => {
	assert.equal(lookupName('GARCIA J'), 'José García');
});

test('accented GOLD name matches', () => {
	assert.equal(lookupName('GARCÍA J'), 'José García');
	assert.equal(lookupName('José García'), 'José García');
});

test('hyphenated last names match', () => {
	assert.equal(lookupName('SMITH-JONES A'), 'Anna Smith-Jones');
});

test("apostrophes in last names are kept", () => {
	assert.equal(lookupName("O'BRIEN K"), "Kevin O'Brien");
	assert.equal(lookupName("Kevin O'Brien"), "Kevin O'Brien");
});

test('a unique last name still matches when the initial is off', () => {
	assert.equal(lookupName('CHILDRESS A'), 'James Childress');
});

test('two profs with the same last name are told apart by first initial', () => {
	// Sarah Lam has far more reviews, which used to make her win every "LAM" lookup
	assert.equal(lookupName('LAM K'), 'Kelvin Lam');
	assert.equal(lookupName('LAM S'), 'Sarah Lam');
	assert.equal(lookupName('Kelvin Lam'), 'Kelvin Lam');
});

test('a shared last name with an unknown initial is not guessed', () => {
	assert.equal(lookupName('LAM J'), null);
});

test('same person listed under two departments still counts as one person', () => {
	const profs = [prof('Ana', 'Ruiz', 4, 'MATH'), prof('Ana', 'Ruiz', 9, 'PSTAT')];
	const hit = m.matchInstructor({ names: ['RUIZ B'] }, m.buildLookup(profs));
	assert.equal(hit.numReviews, 9);
});

test('placeholder instructors do not match anyone', () => {
	assert.equal(lookupName('STAFF'), null);
	assert.equal(lookupName('TBA'), null);
	assert.equal(lookupName(''), null);
});

test('multiple instructors in one cell are split up', () => {
	const info = m.extractInstructorInfo({ textContent: 'PORTER M; LAM K' });
	assert.deepEqual(info.names, ['PORTER M', 'LAM K']);
	assert.deepEqual(m.extractInstructorInfo({ textContent: 'PORTER M / LAM K' }).names, ['PORTER M', 'LAM K']);
	assert.deepEqual(m.extractInstructorInfo({ textContent: 'PORTER M, LAM K' }).names, ['PORTER M', 'LAM K']);
});

test('"Last, First" stays one name', () => {
	assert.deepEqual(m.extractInstructorInfo({ textContent: 'Porter, Matt' }).names, ['Porter, Matt']);
	assert.equal(lookupName('Porter, Matt'), 'Matt Porter');
	assert.equal(lookupName('LAM, KELVIN'), 'Kelvin Lam');
});

test('with two instructors, an exact match beats a loose one', () => {
	assert.equal(lookupName('PORTER M; LAM K'), 'Matt Porter');
});

test('csvProfessorMatches ignores accents', () => {
	const match = { firstName: 'José', lastName: 'García' };
	assert.equal(m.csvProfessorMatches({ csvProfessor: 'Jose Garcia' }, match), true);
	assert.equal(m.csvProfessorMatches({ csvProfessor: 'Maria Lopez' }, match), false);
	assert.equal(m.csvProfessorMatches({ csvProfessor: '' }, match), false);
});

test('review filter matches whole last names only', () => {
	const reviews = ['Lam explains things well', 'the lamb was good', 'clam chowder'];
	const out = m.filterReviewsByInstructor(reviews, { firstName: 'Kelvin', lastName: 'Lam' });
	assert.deepEqual(out, ['Lam explains things well']);
});

test('review filter ignores accents on either side', () => {
	const reviews = ['Garcia is the best', 'Prof García was great', 'Took it with Lopez'];
	const out = m.filterReviewsByInstructor(reviews, { firstName: 'José', lastName: 'García' });
	assert.deepEqual(out, ['Garcia is the best', 'Prof García was great']);
});

test('review filter accepts a first-name mention only with teaching context', () => {
	const reviews = ['Kelvin was a great professor', 'Kelvin is my roommate'];
	const out = m.filterReviewsByInstructor(reviews, { firstName: 'Kelvin', lastName: 'Lam' });
	assert.deepEqual(out, ['Kelvin was a great professor']);
});

test('pickCourseDataForInstructor prefers the record whose reviews mention the instructor', () => {
	const records = [
		{ courseName: 'MATH 2A', recentReviews: ['Rodriguez was fine'] },
		{ courseName: 'MATH 2A', recentReviews: ['Porter is amazing', 'Take Porter if you can'] }
	];
	const picked = m.pickCourseDataForInstructor(records, { firstName: 'Matt', lastName: 'Porter' });
	assert.equal(picked._reviewsFiltered, true);
	assert.deepEqual(picked.recentReviews, ['Porter is amazing', 'Take Porter if you can']);
});
