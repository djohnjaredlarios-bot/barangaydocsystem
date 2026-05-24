// Staff dashboard JavaScript

function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '9999';
    alertDiv.style.maxWidth = '320px';
    document.body.appendChild(alertDiv);

    setTimeout(() => {
        alertDiv.remove();
    }, 4000);
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Request failed');
    }
    return data;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function formatEventTime(event) {
    if (event.start_time && event.end_time) {
        return `${event.start_time} - ${event.end_time}`;
    }
    if (event.start_time) {
        return event.start_time;
    }
    return event.time || 'All day';
}

function renderStaffCalendarDetails(container, dateKey, events) {
    if (!container) return;
    container.innerHTML = `
        <h4>${escapeHtml(dateKey)}</h4>
        ${events.length === 0 ? '<p>No events scheduled for this date.</p>' : ''}
        ${events.map(event => `
            <div class="calendar-item" style="margin-bottom:0.75rem;">
                <strong>${escapeHtml(event.title)}</strong>
                <p>${escapeHtml(formatEventTime(event))}</p>
                <p>${escapeHtml(event.location || '')}</p>
                <p>${escapeHtml(event.description || '')}</p>
                <div style="margin-top:.5rem; display:flex; gap:.5rem; flex-wrap:wrap;">
                    <button class="btn btn-sm btn-secondary" onclick="editStaffEvent(${event.event_id})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteStaffEvent(${event.event_id})">Delete</button>
                </div>
            </div>
        `).join('')}
    `;
}

const eventBroadcastChannel = window.BroadcastChannel ? new BroadcastChannel('barangay-events') : null;

function notifyEventUpdate() {
    if (eventBroadcastChannel) {
        eventBroadcastChannel.postMessage({ type: 'events-updated' });
    }
    try {
        localStorage.setItem('barangay-events-last-update', String(Date.now()));
    } catch (error) {
        // silent fallback for browsers with storage restrictions
    }
}

function renderStaffEventList(events) {
    const listContainer = document.getElementById('staffEventList');
    if (!listContainer) return;

    if (events.length === 0) {
        listContainer.innerHTML = '<p>No events available.</p>';
        return;
    }

    listContainer.innerHTML = events.map(event => `
        <div class="event-row">
            <div>
                <strong>${escapeHtml(event.title)}</strong>
                <div>${escapeHtml(event.date)} ${escapeHtml(formatEventTime(event))}</div>
                <div>${escapeHtml(event.location || '')}</div>
                <div>${escapeHtml(event.description || '')}</div>
            </div>
            <div class="event-actions" style="margin-top: .5rem; display:flex; gap:.5rem; flex-wrap:wrap;">
                <button class="btn btn-sm btn-secondary" onclick="editStaffEvent(${event.event_id})">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteStaffEvent(${event.event_id})">Delete</button>
            </div>
        </div>
    `).join('');
}

async function loadStaffEvents() {
    try {
        const response = await fetch('/api/events');
        const events = await response.json();
        window.currentStaffEvents = events;
        const container = document.getElementById('staffEventsCalendar');

        if (!container) return;

        const eventMap = events.reduce((map, event) => {
            const key = event.date;
            if (!map[key]) {
                map[key] = [];
            }
            map[key].push(event);
            return map;
        }, {});

        const monthDate = new Date();
        const year = monthDate.getFullYear();
        const month = monthDate.getMonth();
        const monthName = monthDate.toLocaleString('default', { month: 'long' });
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let calendarHtml = `<div class="calendar-header"><h4>${monthName} ${year}</h4></div>`;
        calendarHtml += '<div class="calendar-grid">';
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
            calendarHtml += `<div class="calendar-day">${day}</div>`;
        });

        for (let i = 0; i < firstDay; i++) {
            calendarHtml += '<div class="calendar-cell empty"></div>';
        }

        const currentDateKey = new Date().toISOString().slice(0, 10);
        for (let day = 1; day <= daysInMonth; day++) {
            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayEvents = eventMap[dateKey] || [];
            const isToday = dateKey === currentDateKey;
            calendarHtml += `<div class="calendar-cell${isToday ? ' calendar-today' : ''}" data-date="${dateKey}">`;
            calendarHtml += `<div class="calendar-day-number">${day}</div>`;
            if (dayEvents.length > 0) {
                calendarHtml += '<div class="calendar-event-list">';
                const visibleEvents = dayEvents.slice(0, 3);
                visibleEvents.forEach(item => {
                    calendarHtml += `<button class="calendar-event" type="button" data-event-id="${item.event_id}">${escapeHtml(item.title)}<span style="display:block; font-size:.78rem; color:#4a5568;">${escapeHtml(formatEventTime(item))}</span></button>`;
                });
                if (dayEvents.length > visibleEvents.length) {
                    calendarHtml += `<div class="calendar-event-more">+${dayEvents.length - visibleEvents.length} more</div>`;
                }
                calendarHtml += '</div>';
            }
            calendarHtml += '</div>';
        }

        const remainingCells = (7 - ((firstDay + daysInMonth) % 7)) % 7;
        for (let i = 0; i < remainingCells; i++) {
            calendarHtml += '<div class="calendar-cell empty"></div>';
        }

        calendarHtml += '</div>';
        if (events.length === 0) {
            calendarHtml += '<div class="calendar-empty-message">No events scheduled yet.</div>';
        }
        container.innerHTML = calendarHtml;
        const detailsPanel = document.getElementById('eventDetailsPanel');
        if (detailsPanel) {
            renderStaffCalendarDetails(detailsPanel, new Date().toISOString().slice(0, 10), eventMap[new Date().toISOString().slice(0, 10)] || []);
        }
        container.querySelectorAll('.calendar-cell[data-date]').forEach(cell => {
            cell.addEventListener('click', () => {
                const dateKey = cell.dataset.date;
                renderStaffCalendarDetails(detailsPanel, dateKey, eventMap[dateKey] || []);
            });
        });
        container.querySelectorAll('.calendar-event').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const eventId = button.dataset.eventId;
                const eventObj = events.find(item => String(item.event_id) === eventId);
                if (eventObj) {
                    renderStaffCalendarDetails(detailsPanel, eventObj.date, [eventObj]);
                }
            });
        });
        renderStaffEventList(events);
    } catch (error) {
        console.error('Error loading staff events:', error);
        showAlert('Unable to load staff events', 'danger');
    }
}

async function deleteStaffEvent(eventId) {
    if (!confirm('Delete this event?')) return;
    try {
        const response = await fetch(`/api/events/${eventId}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to delete event');
        showAlert(result.message, 'success');
        await loadStaffEvents();
        notifyEventUpdate();
    } catch (error) {
        console.error(error);
        showAlert(error.message, 'danger');
    }
}

async function editStaffEvent(eventId) {
    const event = window.currentStaffEvents?.find(item => item.event_id === eventId);
    if (!event) {
        showAlert('Event not found.', 'warning');
        notifyEventUpdate();
        return;
    }

    const title = prompt('Update event title:', event.title);
    const dateValue = prompt('Update event date (YYYY-MM-DD):', event.date);
    if (!title || !dateValue) {
        showAlert('Title and date cannot be empty.', 'warning');
        return;
    }
    const startTime = prompt('Update event start time (HH:MM):', event.start_time || '') || '';
    const endTime = prompt('Update event end time (HH:MM):', event.end_time || '') || '';
    const location = prompt('Update event location:', event.location || '') || '';
    const description = prompt('Update event description:', event.description || '') || '';

    try {
        const response = await fetch(`/api/events/${eventId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, description, date: dateValue, start_time: startTime || null, end_time: endTime || null, location })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to update event');
        showAlert(result.message, 'success');
        await loadStaffEvents();
        notifyEventUpdate();
    } catch (error) {
        console.error(error);
        showAlert(error.message, 'danger');
    }
}

function renderAnnouncementsCalendar(container, announcements) {
    if (!container) return;

    const announcementMap = announcements.reduce((map, announcement) => {
        const key = announcement.date;
        if (!map[key]) {
            map[key] = [];
        }
        map[key].push(announcement);
        return map;
    }, {});

    const monthDate = announcements.length > 0 ? new Date(announcements[0].date) : new Date();
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const monthName = monthDate.toLocaleString('default', { month: 'long' });
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let calendarHtml = `<div class="calendar-header"><h4>${monthName} ${year}</h4></div>`;
    calendarHtml += '<div class="calendar-grid">';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
        calendarHtml += `<div class="calendar-day">${day}</div>`;
    });

    for (let i = 0; i < firstDay; i++) {
        calendarHtml += '<div class="calendar-cell empty"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayAnnouncements = announcementMap[dateKey] || [];
        calendarHtml += '<div class="calendar-cell">';
        calendarHtml += `<div class="calendar-date">${day}</div>`;
        if (dayAnnouncements.length > 0) {
            calendarHtml += '<div class="calendar-announcements">';
            dayAnnouncements.forEach(item => {
                calendarHtml += `<div class="calendar-item"><strong>${item.title}</strong><div>${item.message}</div></div>`;
            });
            calendarHtml += '</div>';
        }
        calendarHtml += '</div>';
    }

    const remainingCells = (7 - ((firstDay + daysInMonth) % 7)) % 7;
    for (let i = 0; i < remainingCells; i++) {
        calendarHtml += '<div class="calendar-cell empty"></div>';
    }

    calendarHtml += '</div>';
    if (announcements.length === 0) {
        calendarHtml += '<div class="calendar-empty-message">No announcements scheduled for this month.</div>';
    }

    container.innerHTML = calendarHtml;
}

async function loadAnnouncements() {
    try {
        const response = await fetch('/api/announcements');
        const announcements = await response.json();
        const listContainer = document.getElementById('staffAnnouncementsList');

        if (!listContainer) return;

        if (announcements.length === 0) {
            listContainer.innerHTML = '<p>No announcements yet.</p>';
            return;
        }

        listContainer.innerHTML = announcements.map(item => `
            <div class="announcement-item">
                <h5>${item.title}</h5>
                <p>${item.message}</p>
                <small>${item.date}</small>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading announcements:', error);
        showAlert('Unable to load announcements', 'danger');
    }
}

async function addStaffEvent(event) {
    event.preventDefault();

    const title = document.getElementById('eventTitle').value;
    const description = document.getElementById('eventDescription').value;
    const dateValue = document.getElementById('eventDate').value;
    const startTime = document.getElementById('eventStartTime').value;
    const endTime = document.getElementById('eventEndTime').value;
    const location = document.getElementById('eventLocation').value;

    try {
        const response = await fetch('/api/staff/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, description, date: dateValue, start_time: startTime, end_time: endTime, location })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to add event');
        showAlert(result.message, 'success');
        document.getElementById('addEventForm').reset();
        await loadStaffEvents();
        notifyEventUpdate();
    } catch (error) {
        console.error(error);
        showAlert(error.message, 'danger');
    }
}

async function createStaffAnnouncement(event) {
    event.preventDefault();

    const title = document.getElementById('announcementTitle').value;
    const message = document.getElementById('announcementMessage').value;
    const dateValue = document.getElementById('announcementDate').value;

    try {
        const response = await fetch('/api/staff/announcements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, message, date: dateValue })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to post announcement');
        showAlert(result.message, 'success');
        document.getElementById('addAnnouncementForm').reset();
        loadAnnouncements();
    } catch (error) {
        console.error(error);
        showAlert(error.message, 'danger');
    }
}

async function updateRequestStatus(requestId, status) {
    try {
        const result = await fetchJson(`/staff/process-request/${requestId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        showAlert(result.message, 'success');
        loadStaffRequests();
    } catch (error) {
        console.error(error);
        showAlert(error.message, 'danger');
    }
}

async function viewRequestFiles(requestId) {
    try {
        const data = await fetchJson(`/api/requests/${requestId}/files`);

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Attachments for Request ${requestId}</h3>
                    <button id="closeAttachmentsBtn" class="modal-close" aria-label="Close">×</button>
                </div>
                <div id="attachmentsList" style="margin-top:.75rem;"></div>
                <div style="margin-top:1rem;text-align:right;"><button id="closeAttachmentsBtnSecondary" class="btn btn-secondary">Close</button></div>
            </div>
        `;

        document.body.appendChild(modal);

        const listDiv = modal.querySelector('#attachmentsList');
        const items = [];
        if (Array.isArray(data.digital_documents) && data.digital_documents.length) {
            data.digital_documents.forEach(doc => items.push({label: 'Digital Document', url: doc.file_url}));
        }
        if (Array.isArray(data.attachments) && data.attachments.length) {
            data.attachments.forEach(att => items.push({label: att.original_filename || 'Attachment', url: att.file_url}));
        }

        if (items.length === 0) {
            listDiv.innerHTML = '<p>No files attached for this request.</p>';
        } else {
            listDiv.innerHTML = items.map(it => `
                <div style="margin-bottom:.5rem; display:flex; gap:.5rem; align-items:center;">
                    <div style="flex:1;">${escapeHtml(it.label)}</div>
                    <div style="display:flex; gap:.5rem;">
                        <a class="btn btn-sm btn-primary" href="${escapeHtml(it.url)}" target="_blank">Download</a>
                        ${it.url.match(/\.pdf$/i) ? `<button class="btn btn-sm btn-outline" onclick="window.open('${escapeHtml(it.url)}','_blank')">Preview</button>` : ''}
                        ${it.url.match(/\.(png|jpg|jpeg)$/i) ? `<button class="btn btn-sm btn-outline" onclick="(function(u){const w=window.open('','_blank');w.document.write('<img src="'+u+'" style="max-width:100%;height:auto">');})(\'${escapeHtml(it.url)}\')">Preview</button>` : ''}
                    </div>
                </div>
            `).join('');
        }

        modal.querySelector('#closeAttachmentsBtn').addEventListener('click', () => modal.remove());
        modal.querySelector('#closeAttachmentsBtnSecondary').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    } catch (error) {
        console.error(error);
        showAlert(error.message || 'Unable to load attachments', 'danger');
    }
}

async function uploadDigitalDocument(requestId) {
    const input = document.getElementById(`digitalDocument-${requestId}`);
    const file = input?.files?.[0];
    if (!file) {
        showAlert('Please choose a digital document to upload.', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('digital_document', file);

    try {
        const response = await fetch(`/api/staff/requests/${requestId}/digital-document`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to upload digital document');
        showAlert(result.message, 'success');
        loadStaffRequests();
    } catch (error) {
        console.error(error);
        showAlert(error.message, 'danger');
    }
}

function renderDigitalUploadAction(req) {
    if (req.delivery_method !== 'Digital' && req.requires_upload !== 1) return '';

    if (req.digital_file_url) {
        return `<a class="btn btn-sm btn-secondary" href="${escapeHtml(req.digital_file_url)}" target="_blank">Download</a>`;
    }

    return `
        <div class="upload-inline" style="display:flex;flex-direction:column;gap:.35rem;min-width:220px;">
            <div style="font-size:.85rem;color:#555;">Digital request requires a file upload.</div>
            <input type="file" id="digitalDocument-${req.request_id}" name="digital_document" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx">
            <button type="button" class="btn btn-sm btn-primary" onclick="uploadDigitalDocument(${req.request_id})">Upload</button>
        </div>
    `;
}

function renderAttachmentAction(req) {
    const countLabel = req.attachment_count ? ` (${req.attachment_count})` : '';
    return `<button class="btn btn-sm btn-info" onclick="viewRequestFiles(${req.request_id})">Attachments${countLabel}</button>`;
}

async function loadStaffRequests() {
    const tableBody = document.getElementById('staffRequestsBody');
    if (!tableBody) return;

    try {
        const requests = await fetchJson('/api/staff/requests');
        if (requests.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8">No pending requests to process.</td></tr>';
            return;
        }

        tableBody.innerHTML = requests.map(req => `
            <tr>
                <td>${req.request_id}</td>
                <td>${escapeHtml(req.resident_name || req.requester_name || req.name || 'Resident')}</td>
                <td>${escapeHtml(req.document_name)}</td>
                <td>
                    ${req.digital_file_url ? `<a class="btn btn-sm btn-primary" href="${escapeHtml(req.digital_file_url)}" target="_blank">View</a>` : 'N/A'}
                    ${req.delivery_method === 'Digital' && !req.digital_file_url ? `<div style="margin-top:.25rem;font-size:.85rem;color:#d9534f;">Upload required before processing.</div>` : ''}
                    ${req.attachment_count ? `<div style="margin-top:.25rem;font-size:.85rem;color:#444;">${req.attachment_count} attachment${req.attachment_count > 1 ? 's' : ''}</div>` : ''}
                </td>
                <td>${escapeHtml(req.delivery_method)}</td>
                <td><span class="badge badge-${escapeHtml(req.status.toLowerCase())}">${escapeHtml(req.status)}</span></td>
                <td>${escapeHtml(req.appointment_date || 'Not scheduled')}</td>
                <td>${escapeHtml(req.time_slot || 'N/A')}</td>
                <td class="request-card">
                    ${renderDigitalUploadAction(req)}
                    ${renderAttachmentAction(req)}
                    <button class="btn btn-success" onclick="updateRequestStatus(${req.request_id}, 'Processing')">Process</button>
                    <button class="btn btn-warning" onclick="updateRequestStatus(${req.request_id}, 'Approved')">Approve</button>
                    <button class="btn btn-secondary" onclick="updateRequestStatus(${req.request_id}, 'Rejected')">Reject</button>
                    <button class="btn btn-primary" onclick="updateRequestStatus(${req.request_id}, 'Ready')">Mark Ready</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading staff requests:', error);
        tableBody.innerHTML = '<tr><td colspan="9">Unable to load requests.</td></tr>';
    }
}

async function renderPickupAppointmentsBlock() {
    const block = document.getElementById('pickupAppointmentsBlock');
    if (!block) return;

    try {
        const appointments = await fetchJson('/api/staff/pickup-appointments');
        if (appointments.length === 0) {
            block.innerHTML = '<p>No scheduled pickup appointments.</p>';
            return;
        }

        block.innerHTML = `
            <table class="table-full">
                <thead>
                    <tr>
                        <th>Request ID</th>
                        <th>Resident</th>
                        <th>Document</th>
                        <th>Date</th>
                        <th>Time Slot</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${appointments.map(app => `
                        <tr>
                            <td>${app.request_id}</td>
                            <td>${escapeHtml(app.resident_name)}</td>
                            <td>${escapeHtml(app.document_name)}</td>
                            <td>${escapeHtml(app.appointment_date)}</td>
                            <td>${escapeHtml(app.time_slot)}</td>
                            <td>${escapeHtml(app.request_status)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading pickup appointments:', error);
        block.innerHTML = '<p>Unable to load pickup appointments.</p>';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('staffEventsCalendar')) {
        loadStaffEvents();
    }

    if (document.getElementById('staffAnnouncementsList')) {
        loadAnnouncements();
    }

    if (document.getElementById('staffRequestsBody')) {
        loadStaffRequests();
        setInterval(loadStaffRequests, 5000);
    }

    if (document.getElementById('pickupAppointmentsBlock')) {
        renderPickupAppointmentsBlock();
        setInterval(renderPickupAppointmentsBlock, 10000);
    }

    const addEventForm = document.getElementById('addEventForm');
    if (addEventForm) {
        addEventForm.addEventListener('submit', addStaffEvent);
    }

    if (eventBroadcastChannel) {
        eventBroadcastChannel.onmessage = (message) => {
            if (message.data?.type === 'events-updated') {
                loadStaffEvents();
            }
        };
    } else {
        window.addEventListener('storage', (event) => {
            if (event.key === 'barangay-events-last-update') {
                loadStaffEvents();
            }
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && document.getElementById('staffEventsCalendar')) {
            loadStaffEvents();
        }
    });

    if (document.getElementById('staffEventsCalendar')) {
        setInterval(loadStaffEvents, 30000);
    }

    const addAnnouncementForm = document.getElementById('addAnnouncementForm');
    if (addAnnouncementForm) {
        addAnnouncementForm.addEventListener('submit', createStaffAnnouncement);
    }
});
