const API = '';
const PAGE_SIZE = 25;

let allProfessors = [];
let filteredProfessors = [];
let currentPage = 1;
let totalPages = 1;
let showFavoritesOnly = false;

// --- Favorites (localStorage) ---

function getFavorites() {
    try {
        return new Set(JSON.parse(localStorage.getItem('sdsu_favorites') || '[]'));
    } catch { return new Set(); }
}

function saveFavorites(favSet) {
    localStorage.setItem('sdsu_favorites', JSON.stringify([...favSet]));
    updateFavCount();
}

function toggleFavorite(rmpId, event) {
    if (event) event.stopPropagation();
    const favs = getFavorites();
    if (favs.has(rmpId)) favs.delete(rmpId);
    else favs.add(rmpId);
    saveFavorites(favs);

    const star = document.querySelector(`[data-fav-id="${rmpId}"]`);
    if (star) star.classList.toggle('starred', favs.has(rmpId));

    const schedStar = document.querySelector(`[data-sched-fav-id="${rmpId}"]`);
    if (schedStar) schedStar.classList.toggle('starred', favs.has(rmpId));

    if (showFavoritesOnly) applySearch();
}

function updateFavCount() {
    const count = getFavorites().size;
    const badge = document.getElementById('fav-count');
    if (badge) {
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    }
}

function toggleFavoritesFilter() {
    showFavoritesOnly = !showFavoritesOnly;
    const btn = document.getElementById('fav-toggle');
    btn.classList.toggle('active', showFavoritesOnly);
    applySearch();
}

async function init() {
    updateFavCount();
    showLoading('Loading SDSU professor data...');
    try {
        const stats = await fetchJSON('/api/stats');
        if (stats.total_professors === 0 || !stats.last_scraped) {
            await scrapeData();
        } else {
            hideLoading();
            renderStats(stats);
            await loadDepartments();
            await loadRankings();
        }
    } catch {
        await scrapeData();
    }
}

async function scrapeData() {
    showLoading('Scraping SDSU professors from RateMyProfessor...');
    try {
        const result = await fetchJSON('/api/scrape', { method: 'POST' });
        hideLoading();
        if (result.stats) {
            renderStats(result.stats);
        }
        await loadDepartments();
        await loadRankings();
    } catch (err) {
        hideLoading();
        alert('Failed to scrape data: ' + err.message);
    }
}

async function refreshData() {
    const btn = document.getElementById('refresh-btn');
    btn.disabled = true;
    showLoading('Refreshing data from RateMyProfessor...');
    try {
        const result = await fetchJSON('/api/scrape?force=true', { method: 'POST' });
        hideLoading();
        if (result.stats) {
            renderStats(result.stats);
        }
        await loadDepartments();
        await loadRankings();
    } catch (err) {
        hideLoading();
        alert('Failed to refresh data: ' + err.message);
    } finally {
        btn.disabled = false;
    }
}

function renderStats(stats) {
    document.getElementById('stats-section').classList.remove('hidden');

    document.getElementById('stat-total').textContent = stats.rated_professors || stats.total_professors || '--';
    document.getElementById('stat-avg-quality').textContent = stats.avg_quality
        ? stats.avg_quality.toFixed(1) + ' / 5.0'
        : '--';

    if (stats.hardest_department) {
        document.getElementById('stat-hardest-dept').textContent = stats.hardest_department.name;
        document.getElementById('stat-hardest-label').textContent =
            `Hardest Dept (${stats.hardest_department.avg_difficulty} avg difficulty)`;
    }

    if (stats.hardest_professor) {
        document.getElementById('stat-hardest-prof').textContent = stats.hardest_professor.name;
        document.getElementById('stat-hardest-prof-label').textContent =
            `Hardest Prof (${stats.hardest_professor.avg_difficulty}/5 · ${stats.hardest_professor.num_ratings} reviews)`;
    }

    if (stats.last_scraped) {
        const d = new Date(stats.last_scraped);
        document.getElementById('last-scraped').textContent = 'Last updated: ' + d.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
        });
    }
}

async function loadDepartments() {
    const data = await fetchJSON('/api/departments');
    const select = document.getElementById('dept-filter');
    const current = select.value;

    while (select.options.length > 1) select.remove(1);

    for (const dept of data.departments) {
        const opt = document.createElement('option');
        opt.value = dept;
        opt.textContent = dept;
        select.appendChild(opt);
    }

    if (current) select.value = current;
}

async function loadRankings() {
    const sortBy = document.getElementById('sort-select').value;
    const dept = document.getElementById('dept-filter').value;
    const minRatings = document.getElementById('min-ratings').value;

    const params = new URLSearchParams({ sort_by: sortBy, min_ratings: minRatings });
    if (dept) params.set('department', dept);

    const data = await fetchJSON(`/api/rankings?${params}`);
    allProfessors = data.professors;
    applySearch();

    document.getElementById('controls-section').classList.remove('hidden');
    document.getElementById('table-section').classList.remove('hidden');
}

function applySearch() {
    const query = (document.getElementById('search-input').value || '').trim().toLowerCase();
    const clearBtn = document.getElementById('search-clear');
    const favs = getFavorites();

    let result = allProfessors;

    if (showFavoritesOnly) {
        result = result.filter(p => favs.has(p.rmp_id));
    }

    if (query) {
        clearBtn.classList.remove('hidden');
        result = result.filter(p => {
            const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
            return fullName.includes(query);
        });
    } else {
        clearBtn.classList.add('hidden');
    }

    result.forEach((p, i) => p.rank = i + 1);
    filteredProfessors = result;

    totalPages = Math.max(1, Math.ceil(filteredProfessors.length / PAGE_SIZE));
    currentPage = 1;
    renderCurrentPage();
}

function clearSearch() {
    document.getElementById('search-input').value = '';
    applySearch();
    document.getElementById('search-input').focus();
}

function renderCurrentPage() {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageProfs = filteredProfessors.slice(start, end);
    renderTable(pageProfs);
    renderPagination();

    const query = (document.getElementById('search-input').value || '').trim();
    let countText;
    if (showFavoritesOnly && query) {
        countText = `${filteredProfessors.length} favorites matching "${query}"`;
    } else if (showFavoritesOnly) {
        countText = `${filteredProfessors.length} favorite${filteredProfessors.length !== 1 ? 's' : ''}`;
    } else if (query) {
        countText = `${filteredProfessors.length} of ${allProfessors.length} professors`;
    } else {
        countText = `${allProfessors.length} professors`;
    }
    document.getElementById('results-count').textContent = countText;
}

function goToPage(page) {
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderCurrentPage();
    document.getElementById('table-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPagination() {
    const container = document.getElementById('pagination');
    container.innerHTML = '';

    if (totalPages <= 1) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.textContent = '\u2190 Prev';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => goToPage(currentPage - 1);
    container.appendChild(prevBtn);

    const pageNumbers = getPageNumbers(currentPage, totalPages);
    for (const p of pageNumbers) {
        if (p === '...') {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'page-ellipsis';
            ellipsis.textContent = '...';
            container.appendChild(ellipsis);
        } else {
            const btn = document.createElement('button');
            btn.className = 'page-btn' + (p === currentPage ? ' active' : '');
            btn.textContent = p;
            btn.onclick = () => goToPage(p);
            container.appendChild(btn);
        }
    }

    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.textContent = 'Next \u2192';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => goToPage(currentPage + 1);
    container.appendChild(nextBtn);

    const info = document.createElement('span');
    info.className = 'page-info';
    const start = (currentPage - 1) * PAGE_SIZE + 1;
    const end = Math.min(currentPage * PAGE_SIZE, filteredProfessors.length);
    info.textContent = `${start}\u2013${end} of ${filteredProfessors.length}`;
    container.appendChild(info);
}

function getPageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = [];
    pages.push(1);

    if (current > 3) pages.push('...');

    const rangeStart = Math.max(2, current - 1);
    const rangeEnd = Math.min(total - 1, current + 1);
    for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);

    if (current < total - 2) pages.push('...');

    pages.push(total);
    return pages;
}

function renderTable(professors) {
    const tbody = document.getElementById('rankings-body');
    tbody.innerHTML = '';

    if (professors.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="8" style="text-align:center; padding:40px; color:#9ca3af;">No professors found matching these filters.</td>';
        tbody.appendChild(tr);
        return;
    }

    for (const prof of professors) {
        const tr = document.createElement('tr');
        tr.dataset.rmpId = prof.rmp_id;
        tr.onclick = () => toggleExpand(prof.rmp_id);

        const ratingClass = getRatingClass(prof.avg_rating);
        const diffClass = getDifficultyClass(prof.avg_difficulty);
        const wtaDisplay = prof.would_take_again_pct >= 0
            ? prof.would_take_again_pct.toFixed(0) + '%'
            : 'N/A';
        const wtaClass = prof.would_take_again_pct >= 0
            ? getRatingClass(prof.would_take_again_pct / 20)
            : 'rating-none';

        const isFav = getFavorites().has(prof.rmp_id);
        tr.innerHTML = `
            <td class="col-rank">${prof.rank}</td>
            <td class="col-name">
                <button class="btn-star ${isFav ? 'starred' : ''}" data-fav-id="${prof.rmp_id}" onclick="toggleFavorite(${prof.rmp_id}, event)" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </button>
                <span class="prof-name">${prof.first_name} ${prof.last_name}</span>
                <a class="prof-link" href="https://www.ratemyprofessors.com/search/professors/877?q=${encodeURIComponent(prof.first_name + ' ' + prof.last_name)}" target="_blank" rel="noopener">RMP &rarr;</a>
            </td>
            <td class="col-dept">${prof.department}</td>
            <td class="col-rating"><span class="rating-badge ${ratingClass}">${prof.avg_rating > 0 ? prof.avg_rating.toFixed(1) : 'N/A'}</span></td>
            <td class="col-difficulty"><span class="difficulty-badge ${diffClass}">${prof.avg_difficulty > 0 ? prof.avg_difficulty.toFixed(1) : 'N/A'}</span></td>
            <td class="col-wta"><span class="wta-value ${wtaClass}">${wtaDisplay}</span></td>
            <td class="col-count">${prof.num_ratings}</td>
            <td class="col-score"><span class="score-badge">${(prof.weighted_score * 100).toFixed(0)}%</span></td>
        `;

        tbody.appendChild(tr);

        {
            const expandRow = document.createElement('tr');
            expandRow.className = 'expand-row';
            expandRow.id = `expand-${prof.rmp_id}`;

            const hasTags = prof.tags && prof.tags.length > 0;
            const hasCourses = prof.courses && prof.courses.length > 0;

            let tagsHtml = '';
            if (hasTags) {
                tagsHtml = `
                    <div class="expand-section">
                        <span class="expand-label">Tags</span>
                        <div class="tags-container">
                            ${prof.tags.map(t => `<span class="tag">${t.name}<span class="tag-count">(${t.count})</span></span>`).join('')}
                        </div>
                    </div>`;
            }

            let coursesHtml = '';
            if (hasCourses) {
                coursesHtml = `
                    <div class="expand-section">
                        <span class="expand-label">Courses</span>
                        <div class="tags-container">
                            ${prof.courses.map(c => `<span class="tag course-tag">${c.name}<span class="tag-count">(${c.count})</span></span>`).join('')}
                        </div>
                    </div>`;
            }

            const reviewsHtml = `
                <div class="expand-section">
                    <button class="btn-reviews" onclick="event.stopPropagation(); loadReviews(${prof.rmp_id})" id="reviews-btn-${prof.rmp_id}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        Show Student Reviews
                    </button>
                    <div id="reviews-container-${prof.rmp_id}" class="reviews-container"></div>
                </div>`;

            expandRow.innerHTML = `<td colspan="8">${tagsHtml}${coursesHtml}${reviewsHtml}</td>`;
            tbody.appendChild(expandRow);
        }
    }
}

function toggleExpand(rmpId) {
    const row = document.getElementById(`expand-${rmpId}`);
    if (row) {
        row.classList.toggle('visible');
    }
}

async function loadReviews(rmpId, prefix = '') {
    const btn = document.getElementById(`${prefix}reviews-btn-${rmpId}`);
    const container = document.getElementById(`${prefix}reviews-container-${rmpId}`);

    if (container.dataset.loaded === 'true') {
        container.classList.toggle('hidden');
        btn.textContent = container.classList.contains('hidden') ? 'Show Student Reviews' : 'Hide Reviews';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Loading reviews...';

    try {
        const data = await fetchJSON(`/api/professor/${rmpId}/reviews`);
        container.dataset.loaded = 'true';

        if (!data.reviews || data.reviews.length === 0) {
            container.innerHTML = '<p class="review-empty">No reviews available.</p>';
        } else {
            container.innerHTML = data.reviews.map(r => {
                const date = r.date ? new Date(r.date).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric'
                }) : '';
                const qualityClass = getRatingClass(r.quality);
                const diffClass = getDifficultyClass(r.difficulty);
                const wtaText = r.would_take_again === 1 ? 'Yes' : r.would_take_again === 0 ? 'No' : '';
                const tagsStr = r.tags ? r.tags.split('--').filter(t => t.trim()).map(t =>
                    `<span class="review-tag">${t.trim()}</span>`
                ).join('') : '';

                return `
                    <div class="review-card">
                        <div class="review-header">
                            <div class="review-badges">
                                <span class="review-metric rating-badge ${qualityClass}"><span class="metric-label">Quality</span>${r.quality != null ? r.quality.toFixed(1) : 'N/A'}</span>
                                <span class="review-metric difficulty-badge ${diffClass}"><span class="metric-label">Difficulty</span>${r.difficulty != null ? r.difficulty.toFixed(1) : 'N/A'}</span>
                                ${r.class_name ? `<span class="review-class">${r.class_name}</span>` : ''}
                                ${r.grade ? `<span class="review-grade">Grade: ${r.grade}</span>` : ''}
                                ${wtaText ? `<span class="review-wta">${wtaText === 'Yes' ? 'Would take again' : 'Would not take again'}</span>` : ''}
                            </div>
                            <span class="review-date">${date}</span>
                        </div>
                        ${r.comment ? `<p class="review-comment">${r.comment}</p>` : ''}
                        ${tagsStr ? `<div class="review-tags">${tagsStr}</div>` : ''}
                        <div class="review-votes">
                            <span class="vote-up">&#9650; ${r.thumbs_up}</span>
                            <span class="vote-down">&#9660; ${r.thumbs_down}</span>
                        </div>
                    </div>`;
            }).join('');
        }

        btn.textContent = 'Hide Reviews';
    } catch (err) {
        container.innerHTML = '<p class="review-empty">Failed to load reviews.</p>';
        btn.textContent = 'Show Student Reviews';
        btn.disabled = false;
        return;
    }

    btn.disabled = false;
}

// --- Tab Switching ---

let activeTab = 'rankings';

function switchTab(tab) {
    activeTab = tab;

    document.getElementById('tab-btn-rankings').classList.toggle('active', tab === 'rankings');
    document.getElementById('tab-btn-schedule').classList.toggle('active', tab === 'schedule');
    document.getElementById('tab-btn-departments').classList.toggle('active', tab === 'departments');

    const sections = {
        rankings: ['stats-section', 'controls-section', 'table-section'],
        schedule: ['schedule-section'],
        departments: ['departments-section'],
    };

    for (const [key, ids] of Object.entries(sections)) {
        const show = key === tab;
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (show) { el.style.display = ''; el.classList.remove('hidden'); }
            else { el.style.display = 'none'; el.classList.add('hidden'); }
        });
    }

    if (tab === 'departments' && !allDeptStats) loadDepartmentStats();
}

// --- Schedule Builder ---

async function submitSchedule() {
    const input = document.getElementById('schedule-input').value.trim();
    const resultsDiv = document.getElementById('schedule-results');
    const btn = document.getElementById('schedule-submit-btn');

    if (!input) {
        resultsDiv.innerHTML = '<p class="schedule-no-input">Enter one or more course codes above to get started.</p>';
        return;
    }

    const courses = input.split(',').map(c => c.trim()).filter(Boolean);
    if (courses.length === 0) return;

    btn.disabled = true;
    btn.textContent = 'Searching...';
    resultsDiv.innerHTML = '';

    try {
        const data = await fetchJSON('/api/schedule', {
            method: 'POST',
            body: JSON.stringify({ courses }),
        });

        if (!data.results || Object.keys(data.results).length === 0) {
            resultsDiv.innerHTML = '<p class="schedule-no-input">No results found for those course codes.</p>';
        } else {
            resultsDiv.innerHTML = Object.entries(data.results).map(([code, profs]) => {
                if (!profs || profs.length === 0) {
                    return `
                        <div class="course-card">
                            <div class="course-card-header">
                                <span class="course-code">${code}</span>
                                <span class="course-count">0 professors</span>
                            </div>
                            <p class="course-empty">No professors found teaching this course.</p>
                        </div>`;
                }

                const rows = profs.map(p => {
                    const ratingClass = getRatingClass(p.avg_rating);
                    const diffClass = getDifficultyClass(p.avg_difficulty);
                    const wtaDisplay = p.would_take_again_pct >= 0
                        ? p.would_take_again_pct.toFixed(0) + '%' : 'N/A';
                    const score = (p.weighted_score * 100).toFixed(0) + '%';
                    const sFav = getFavorites().has(p.rmp_id);

                    return `
                        <tr onclick="toggleScheduleExpand(${p.rmp_id})" style="cursor:pointer">
                            <td class="col-rank">${p.rank}</td>
                            <td>
                                <button class="btn-star ${sFav ? 'starred' : ''}" data-sched-fav-id="${p.rmp_id}" onclick="toggleFavorite(${p.rmp_id}, event)" title="${sFav ? 'Remove from favorites' : 'Add to favorites'}">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${sFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                </button>
                                <span class="prof-name">${p.first_name} ${p.last_name}</span>
                                <a class="prof-link" href="https://www.ratemyprofessors.com/search/professors/877?q=${encodeURIComponent(p.first_name + ' ' + p.last_name)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">RMP &rarr;</a>
                            </td>
                            <td>${p.department}</td>
                            <td><span class="rating-badge ${ratingClass}">${p.avg_rating > 0 ? p.avg_rating.toFixed(1) : 'N/A'}</span></td>
                            <td><span class="difficulty-badge ${diffClass}">${p.avg_difficulty > 0 ? p.avg_difficulty.toFixed(1) : 'N/A'}</span></td>
                            <td>${wtaDisplay}</td>
                            <td>${p.num_ratings}</td>
                            <td><span class="score-badge">${score}</span></td>
                        </tr>
                        <tr class="expand-row" id="sched-expand-${p.rmp_id}">
                            <td colspan="8">
                                ${p.tags && p.tags.length > 0 ? `
                                <div class="expand-section">
                                    <span class="expand-label">Tags</span>
                                    <div class="tags-container">
                                        ${p.tags.map(t => `<span class="tag">${t.name}<span class="tag-count">(${t.count})</span></span>`).join('')}
                                    </div>
                                </div>` : ''}
                                ${p.courses && p.courses.length > 0 ? `
                                <div class="expand-section">
                                    <span class="expand-label">Courses</span>
                                    <div class="tags-container">
                                        ${p.courses.map(c => `<span class="tag course-tag">${c.name}<span class="tag-count">(${c.count})</span></span>`).join('')}
                                    </div>
                                </div>` : ''}
                                <div class="expand-section">
                                    <button class="btn-reviews" onclick="event.stopPropagation(); loadReviews(${p.rmp_id}, 'sched-')" id="sched-reviews-btn-${p.rmp_id}">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                        Show Student Reviews
                                    </button>
                                    <div id="sched-reviews-container-${p.rmp_id}" class="reviews-container"></div>
                                </div>
                            </td>
                        </tr>`;
                }).join('');

                return `
                    <div class="course-card">
                        <div class="course-card-header">
                            <span class="course-code">${code}</span>
                            <span class="course-count">${profs.length} professor${profs.length !== 1 ? 's' : ''}</span>
                        </div>
                        <table class="course-table">
                            <thead>
                                <tr>
                                    <th class="col-rank">#</th>
                                    <th>Professor</th>
                                    <th>Department</th>
                                    <th>Rating</th>
                                    <th>Difficulty</th>
                                    <th>Take Again</th>
                                    <th>Reviews</th>
                                    <th>Score</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>`;
            }).join('');
        }
    } catch (err) {
        resultsDiv.innerHTML = '<p class="schedule-no-input">Something went wrong. Please try again.</p>';
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Find Professors <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
    }
}

function toggleScheduleExpand(rmpId) {
    const row = document.getElementById(`sched-expand-${rmpId}`);
    if (row) row.classList.toggle('visible');
}

// --- Department Stats ---

let allDeptStats = null;

async function loadDepartmentStats() {
    const grid = document.getElementById('dept-grid');
    grid.innerHTML = '<p class="dept-no-results">Loading department data...</p>';

    try {
        const data = await fetchJSON('/api/department-stats');
        allDeptStats = data.departments;
        renderDeptGrid(allDeptStats);
    } catch {
        grid.innerHTML = '<p class="dept-no-results">Failed to load department stats.</p>';
    }
}

function renderDeptGrid(departments) {
    const grid = document.getElementById('dept-grid');
    const detail = document.getElementById('dept-detail');
    grid.style.display = '';
    detail.classList.add('hidden');
    grid.innerHTML = '';

    document.getElementById('dept-count').textContent = `${departments.length} departments`;

    if (departments.length === 0) {
        grid.innerHTML = '<p class="dept-no-results">No departments found.</p>';
        return;
    }

    for (const dept of departments) {
        const card = document.createElement('div');
        card.className = 'dept-card';
        card.onclick = () => openDeptDetail(dept.name);

        const ratingClass = getRatingClass(dept.avg_rating);
        const diffClass = getDifficultyClass(dept.avg_difficulty);
        const wtaDisplay = dept.avg_wta != null ? dept.avg_wta.toFixed(0) + '%' : 'N/A';

        card.innerHTML = `
            <div class="dept-card-name">${dept.name}</div>
            <div class="dept-card-stats">
                <div class="dept-stat">
                    <span class="dept-stat-value"><span class="rating-badge ${ratingClass}">${dept.avg_rating.toFixed(1)}</span></span>
                    <span class="dept-stat-label">Avg Rating</span>
                </div>
                <div class="dept-stat">
                    <span class="dept-stat-value"><span class="difficulty-badge ${diffClass}">${dept.avg_difficulty.toFixed(1)}</span></span>
                    <span class="dept-stat-label">Avg Difficulty</span>
                </div>
                <div class="dept-stat">
                    <span class="dept-stat-value">${wtaDisplay}</span>
                    <span class="dept-stat-label">Take Again</span>
                </div>
                <div class="dept-stat">
                    <span class="dept-stat-value">${dept.professor_count}</span>
                    <span class="dept-stat-label">Professors</span>
                </div>
            </div>
            <div class="dept-card-footer">
                <span>${dept.total_reviews.toLocaleString()} reviews</span>
                <span>${dept.top_professors.length} top profs &rarr;</span>
            </div>
        `;
        grid.appendChild(card);
    }
}

function openDeptDetail(deptName) {
    const dept = allDeptStats.find(d => d.name === deptName);
    if (!dept) return;

    const grid = document.getElementById('dept-grid');
    const detail = document.getElementById('dept-detail');
    const controls = document.querySelector('.dept-controls');

    grid.style.display = 'none';
    if (controls) controls.style.display = 'none';
    detail.classList.remove('hidden');

    const wtaDisplay = dept.avg_wta != null ? dept.avg_wta.toFixed(0) + '%' : 'N/A';
    const ratingClass = getRatingClass(dept.avg_rating);
    const diffClass = getDifficultyClass(dept.avg_difficulty);

    let profRows = '';
    if (dept.top_professors.length > 0) {
        profRows = dept.top_professors.map(p => {
            const pRating = getRatingClass(p.avg_rating);
            const pDiff = getDifficultyClass(p.avg_difficulty);
            const score = (p.weighted_score * 100).toFixed(0) + '%';
            const isFav = getFavorites().has(p.rmp_id);
            return `
                <tr onclick="toggleDeptProfExpand(${p.rmp_id})" style="cursor:pointer">
                    <td style="text-align:center; color:var(--text-tertiary)">${p.rank}</td>
                    <td>
                        <button class="btn-star ${isFav ? 'starred' : ''}" data-dept-fav-id="${p.rmp_id}" onclick="toggleFavorite(${p.rmp_id}, event)" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                        </button>
                        <span class="prof-name">${p.first_name} ${p.last_name}</span>
                        <a class="prof-link" href="https://www.ratemyprofessors.com/search/professors/877?q=${encodeURIComponent(p.first_name + ' ' + p.last_name)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">RMP &rarr;</a>
                    </td>
                    <td><span class="rating-badge ${pRating}">${p.avg_rating > 0 ? p.avg_rating.toFixed(1) : 'N/A'}</span></td>
                    <td><span class="difficulty-badge ${pDiff}">${p.avg_difficulty > 0 ? p.avg_difficulty.toFixed(1) : 'N/A'}</span></td>
                    <td>${p.num_ratings}</td>
                    <td><span class="score-badge">${score}</span></td>
                </tr>
                <tr class="expand-row" id="dept-expand-${p.rmp_id}">
                    <td colspan="6">
                        <div class="expand-section">
                            <button class="btn-reviews" onclick="event.stopPropagation(); loadReviews(${p.rmp_id}, 'dept-')" id="dept-reviews-btn-${p.rmp_id}">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                Show Student Reviews
                            </button>
                            <div id="dept-reviews-container-${p.rmp_id}" class="reviews-container"></div>
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }

    const tagsHtml = dept.top_tags.length > 0
        ? dept.top_tags.map(t => `<span class="tag">${t.name}<span class="tag-count">(${t.count})</span></span>`).join('')
        : '<span style="color:var(--text-quaternary)">No tags available</span>';

    detail.innerHTML = `
        <button class="dept-detail-back" onclick="closeDeptDetail()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            All Departments
        </button>
        <div class="dept-detail-header">
            <h2>${dept.name}</h2>
            <div class="dept-detail-stats">
                <div class="dept-detail-stat">
                    <span class="dept-detail-stat-value"><span class="rating-badge ${ratingClass}">${dept.avg_rating.toFixed(1)}</span></span>
                    <span class="dept-detail-stat-label">Avg Rating</span>
                </div>
                <div class="dept-detail-stat">
                    <span class="dept-detail-stat-value"><span class="difficulty-badge ${diffClass}">${dept.avg_difficulty.toFixed(1)}</span></span>
                    <span class="dept-detail-stat-label">Avg Difficulty</span>
                </div>
                <div class="dept-detail-stat">
                    <span class="dept-detail-stat-value">${wtaDisplay}</span>
                    <span class="dept-detail-stat-label">Would Take Again</span>
                </div>
                <div class="dept-detail-stat">
                    <span class="dept-detail-stat-value">${dept.professor_count}</span>
                    <span class="dept-detail-stat-label">Professors</span>
                </div>
                <div class="dept-detail-stat">
                    <span class="dept-detail-stat-value">${dept.total_reviews.toLocaleString()}</span>
                    <span class="dept-detail-stat-label">Total Reviews</span>
                </div>
            </div>
        </div>
        <div class="dept-detail-section">
            <h3>Top Professors</h3>
            ${dept.top_professors.length > 0 ? `
            <table class="dept-detail-table">
                <thead>
                    <tr>
                        <th style="width:40px; text-align:center">#</th>
                        <th>Professor</th>
                        <th>Rating</th>
                        <th>Difficulty</th>
                        <th>Reviews</th>
                        <th>Score</th>
                    </tr>
                </thead>
                <tbody>${profRows}</tbody>
            </table>` : '<p style="color:var(--text-quaternary)">Not enough data for this department.</p>'}
        </div>
        <div class="dept-detail-section">
            <h3>Most Common Tags</h3>
            <div class="dept-detail-tags">${tagsHtml}</div>
        </div>
    `;
}

function closeDeptDetail() {
    const grid = document.getElementById('dept-grid');
    const detail = document.getElementById('dept-detail');
    const controls = document.querySelector('.dept-controls');

    detail.classList.add('hidden');
    grid.style.display = '';
    if (controls) controls.style.display = '';
}

function toggleDeptProfExpand(rmpId) {
    const row = document.getElementById(`dept-expand-${rmpId}`);
    if (row) row.classList.toggle('visible');
}

function filterDepts() {
    if (!allDeptStats) return;
    const query = (document.getElementById('dept-search-input').value || '').trim().toLowerCase();
    if (!query) {
        renderDeptGrid(allDeptStats);
        return;
    }
    const filtered = allDeptStats.filter(d => d.name.toLowerCase().includes(query));
    renderDeptGrid(filtered);
}

function getRatingClass(rating) {
    if (!rating || rating <= 0) return 'rating-none';
    if (rating >= 4.0) return 'rating-high';
    if (rating >= 3.0) return 'rating-mid';
    return 'rating-low';
}

function getDifficultyClass(difficulty) {
    if (!difficulty || difficulty <= 0) return 'rating-none';
    if (difficulty <= 2.5) return 'rating-high';
    if (difficulty <= 3.5) return 'rating-mid';
    return 'rating-low';
}

function showLoading(text) {
    document.getElementById('loading-text').textContent = text || 'Loading...';
    document.getElementById('loading-progress').textContent = '';
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

async function fetchJSON(url, options = {}) {
    const res = await fetch(API + url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

document.addEventListener('DOMContentLoaded', init);
