// Barangay System - Main JavaScript

// Helper function to show alerts
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

// Modal functions
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

document.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
});

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

const documentsCache = {};

function updateDeliveryMethodVisibility(documentId) {
    const deliveryMethodGroup = document.getElementById('deliveryMethodGroup');
    const deliveryMethod = document.getElementById('deliveryMethod');
    const uploadField = document.getElementById('documentUploadField');
    const selectedDocument = documentsCache[documentId];

    if (!selectedDocument) {
        if (deliveryMethodGroup) deliveryMethodGroup.hidden = true;
        if (uploadField) uploadField.hidden = true;
        return;
    }

    if (deliveryMethodGroup) {
        deliveryMethodGroup.hidden = false;
        if (deliveryMethod) {
            deliveryMethod.value = 'Physical';
            if (!selectedDocument.is_digital_available) {
                deliveryMethod.querySelector('option[value="Digital"]').disabled = true;
                deliveryMethod.querySelector('option[value="Digital"]').textContent = 'Digital (not available)';
            } else {
                deliveryMethod.querySelector('option[value="Digital"]').disabled = false;
                deliveryMethod.querySelector('option[value="Digital"]').textContent = 'Digital';
            }
        }
    }

    updateFileUploadVisibility();
}

function updateFileUploadVisibility() {
    const deliveryMethod = document.getElementById('deliveryMethod')?.value;
    const documentUploadField = document.getElementById('documentUploadField');
    if (!documentUploadField) return;

    if (deliveryMethod === 'Digital') {
        documentUploadField.hidden = false;
    } else {
        documentUploadField.hidden = true;
        // Do not forcibly clear the file input here; keep selection until explicit reset
    }
}

function updateDigitalFilenameDisplay() {
    const input = document.getElementById('digitalDocumentUpload');
    const nameDiv = document.getElementById('digitalDocumentName');
    if (!nameDiv) return;
    if (input && input.files && input.files[0]) {
        nameDiv.textContent = input.files[0].name;
    } else {
        nameDiv.textContent = '';
    }
}

const eventBroadcastChannel = window.BroadcastChannel ? new BroadcastChannel('barangay-events') : null;

function refreshEventsIfNeeded() {
    if (document.getElementById('eventsContainer')) {
        loadEvents();
    }
}

window.addEventListener('storage', (event) => {
    if (event.key === 'barangay-events-last-update') {
        refreshEventsIfNeeded();
    }
});

if (eventBroadcastChannel) {
    eventBroadcastChannel.onmessage = (message) => {
        if (message.data?.type === 'events-updated') {
            refreshEventsIfNeeded();
        }
    };
}
function formatDate(value) {
    if (!value) return 'N/A';
    return new Date(value).toLocaleDateString();
}

async function loadStaffEvents() {
    try {
        const response = await fetch('/api/events');
        const events = await response.json();
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

        const monthDate = events.length > 0 ? new Date(events[0].date) : new Date();
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
            const dayEvents = eventMap[dateKey] || [];
            calendarHtml += '<div class="calendar-cell">';
            calendarHtml += `<div class="calendar-date">${day}</div>`;
            if (dayEvents.length > 0) {
                calendarHtml += '<div class="calendar-announcements">';
                dayEvents.forEach(item => {
                    calendarHtml += `<div class="calendar-item"><strong>${item.title}</strong><div>${item.time || ''} · ${item.location || ''}</div></div>`;
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
        if (events.length === 0) {
            calendarHtml += '<div class="calendar-empty-message">No events scheduled yet.</div>';
        }
        container.innerHTML = calendarHtml;
    } catch (error) {
        console.error('Error loading staff events:', error);
        showAlert('Unable to load staff events', 'danger');
    }
}

async function addStaffEvent(event) {
    event.preventDefault();
    const title = document.getElementById('eventTitle').value;
    const description = document.getElementById('eventDescription').value;
    const dateValue = document.getElementById('eventDate').value;
    const timeValue = document.getElementById('eventTime').value;
    const location = document.getElementById('eventLocation').value;

    try {
        const response = await fetch('/api/staff/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, description, date: dateValue, time: timeValue, location })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to add event');
        showAlert(result.message, 'success');
        document.getElementById('addEventForm').reset();
        loadStaffEvents();
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
        const response = await fetch(`/staff/process-request/${requestId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to update request');
        showAlert(result.message, 'success');
        window.location.reload();
    } catch (error) {
        console.error(error);
        showAlert(error.message, 'danger');
    }
}

// API function to fetch documents
async function loadDocuments() {
    try {
        const response = await fetch('/api/documents');
        const documents = await response.json();
        const selectElement = document.getElementById('documentSelect');

        documents.forEach(doc => {
            documentsCache[doc.document_id] = doc;
        });

        if (selectElement) {
            selectElement.innerHTML = '<option value="">-- Select a document --</option>';
            const groups = documents.reduce((acc, doc) => {
                const category = doc.category || 'Other';
                acc[category] = acc[category] || [];
                acc[category].push(doc);
                return acc;
            }, {});

            Object.keys(groups).forEach(category => {
                const optgroup = document.createElement('optgroup');
                optgroup.label = category;
                groups[category].forEach(doc => {
                    const option = document.createElement('option');
                    option.value = doc.document_id;
                    option.textContent = doc.document_name;
                    optgroup.appendChild(option);
                });
                selectElement.appendChild(optgroup);
            });
        }

        return documents;
    } catch (error) {
        console.error('Error loading documents:', error);
        showAlert('Error loading documents', 'danger');
    }
}

// API function to load document requirements
async function loadRequirements(documentId) {
    const requirementsDiv = document.getElementById('requirementsList');
    if (!documentId || !requirementsDiv) return;

    updateDeliveryMethodVisibility(documentId);

    const isGuestRequestForm = Boolean(document.getElementById('guestRequestForm'));
    const baseRequirements = [
        'Full Name',
        'Civil Status',
        'Age',
        'Claiming Method',
        'Contact Number'
    ];

    try {
        const response = await fetch(`/api/document/${documentId}/requirements`);
        const requirements = await response.json();

        if (isGuestRequestForm) {
            const additionalFields = requirements.map(req => {
                if (req.is_file || req.is_file === 1) {
                    return `
                        <div class="form-group">
                            <label for="detail-${req.requirement_id}">${escapeHtml(req.requirement_name)}</label>
                            <input type="file" id="detail-${req.requirement_id}" name="requirement_${req.requirement_id}" class="document-detail-file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" data-requirement-name="${escapeHtml(req.requirement_name)}">
                            <small class="form-text">${escapeHtml(req.description || '')}</small>
                        </div>
                    `;
                }
                return `
                    <div class="form-group">
                        <label for="detail-${req.requirement_id}">${escapeHtml(req.requirement_name)}</label>
                        <input type="text" id="detail-${req.requirement_id}" class="document-detail-input" data-field-name="${escapeHtml(req.requirement_name)}" required placeholder="${escapeHtml(req.description || req.requirement_name)}">
                    </div>
                `;
            }).join('');

            requirementsDiv.innerHTML = `
                <div class="form-group">
                    <label for="requesterName">Full Name</label>
                    <input type="text" id="requesterName" name="requesterName" required placeholder="Your full name">
                </div>
                <div class="form-group">
                    <label for="civilStatus">Civil Status</label>
                    <select id="civilStatus" name="civilStatus" required>
                        <option value="">Select civil status</option>
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Widowed">Widowed</option>
                        <option value="Separated">Separated</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="requesterAge">Age</label>
                    <input type="number" id="requesterAge" name="requesterAge" required placeholder="Enter age" min="1">
                </div>
                <div class="form-group">
                    <label for="claimingMethod">Claiming Method</label>
                    <select id="claimingMethod" name="claimingMethod" required>
                        <option value="">Select claiming method</option>
                        <option value="In-Person Pick up">In-Person Pick up</option>
                        <option value="Digital">Digital</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="requesterContact">Contact Number</label>
                    <input type="text" id="requesterContact" name="requesterContact" required placeholder="Phone number">
                </div>
                ${additionalFields}
            `;
            document.querySelectorAll('.document-detail-file').forEach(input => {
                input.addEventListener('change', updateGuestFilePreview);
            });
            updateGuestFilePreview();
            document.getElementById('claimingMethod').addEventListener('change', updatePickupScheduleVisibility);
            updatePickupScheduleVisibility();
            return;
        }

        requirementsDiv.innerHTML = '<h4>Required Details:</h4><ul>' +
            baseRequirements.map(req => `<li>${req}</li>`).join('') +
            '</ul>';

        const selectedDocument = documentsCache[documentId];
        if (selectedDocument && selectedDocument.is_digital_available) {
            requirementsDiv.innerHTML += '<p class="note">This document supports digital delivery. Select Digital and upload your file when submitting.</p>';
        }

        if (requirements.length > 0) {
            // Separate file-type requirements from text-type requirements
            const fileReqs = requirements.filter(r => r.is_file || r.is_file === 1);
            const textReqs = requirements.filter(r => !(r.is_file || r.is_file === 1));

            if (textReqs.length > 0) {
                requirementsDiv.innerHTML += '<h4>Additional Requirements:</h4><ul>' + textReqs.map(r => `<li>${escapeHtml(r.requirement_name)}</li>`).join('') + '</ul>';
            }

            if (fileReqs.length > 0) {
                requirementsDiv.innerHTML += fileReqs.map(req => `
                    <div class="form-group">
                        <label for="requirement-${req.requirement_id}">${escapeHtml(req.requirement_name)}</label>
                        <input type="file" id="requirement-${req.requirement_id}" name="requirement_${req.requirement_id}" class="requirement-file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx">
                        <small class="form-text">${escapeHtml(req.description || '')}</small>
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Error loading requirements:', error);
        requirementsDiv.innerHTML = '<p>Unable to load requirements.</p>';
    }
}

function updatePickupScheduleVisibility() {
    const claimingMethod = document.getElementById('claimingMethod')?.value;
    const pickupScheduleGroup = document.getElementById('pickupScheduleGroup');
    const selectedSlotId = document.getElementById('selectedSlotId');
    const selectedSlotInfo = document.getElementById('selectedSlotInfo');
    if (!pickupScheduleGroup) return;

    const needsPickup = claimingMethod === 'In-Person Pick up';
    pickupScheduleGroup.hidden = !needsPickup;
    if (!needsPickup) {
        if (selectedSlotId) selectedSlotId.value = '';
        if (selectedSlotInfo) selectedSlotInfo.textContent = 'No slot selected yet.';
    }
}

function updateGuestFilePreview() {
    const previewGroup = document.getElementById('guestFilePreviewGroup');
    const previewContainer = document.getElementById('guestFilePreview');
    const fileInputs = Array.from(document.querySelectorAll('.document-detail-file'));

    if (!previewGroup || !previewContainer) return;
    if (fileInputs.length === 0) {
        previewGroup.hidden = true;
        return;
    }

    const fileRows = fileInputs.map(input => {
        const file = input.files?.[0];
        const label = input.dataset.requirementName || input.previousElementSibling?.textContent || input.name;
        if (!file) {
            return `<div class="preview-item"><strong>${escapeHtml(label)}:</strong> <span style="color:#888;">No file selected</span></div>`;
        }

        const sizeKb = (file.size / 1024).toFixed(1);
        return `<div class="preview-item"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(file.name)} <span style="color:#666;font-size:0.9em;">(${sizeKb} KB)</span></div>`;
    });

    previewGroup.hidden = false;
    previewContainer.innerHTML = fileRows.join('') || '<p style="margin:0;color:#555;">No files selected yet.</p>';
}

// Submit a guest request without login
async function submitGuestRequest(event) {
    event.preventDefault();

    const documentId = document.getElementById('documentSelect').value;
    const name = document.getElementById('requesterName')?.value.trim();
    const contact = document.getElementById('requesterContact')?.value.trim();
    const civilStatus = document.getElementById('civilStatus')?.value;
    const age = document.getElementById('requesterAge')?.value;
    const claimingMethod = document.getElementById('claimingMethod')?.value;
    const slotId = document.getElementById('selectedSlotId').value;
    const details = Array.from(document.querySelectorAll('.document-detail-input')).reduce((values, input) => {
        values[input.dataset.fieldName] = input.value.trim();
        return values;
    }, {});

    if (!documentId || !name || !contact || !civilStatus || !age || !claimingMethod) {
        showAlert('Please complete all required fields.', 'warning');
        return;
    }

    if (Object.values(details).some(value => !value)) {
        showAlert('Please complete all document-specific requirements.', 'warning');
        return;
    }

    const fileInputs = Array.from(document.querySelectorAll('.document-detail-file'));
    if (fileInputs.some(input => input.required && !(input.files && input.files[0]))) {
        showAlert('Please attach all required files for your document request.', 'warning');
        return;
    }

    if (claimingMethod === 'In-Person Pick up' && !slotId) {
        showAlert('Please select a pickup schedule slot.', 'warning');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('document_id', documentId);
        formData.append('requester_name', name);
        formData.append('requester_contact', contact);
        formData.append('civil_status', civilStatus);
        formData.append('age', Number(age));
        formData.append('claiming_method', claimingMethod);
        if (slotId) {
            formData.append('slot_id', slotId);
        }
        formData.append('details', JSON.stringify(details));

        const fileInputs = Array.from(document.querySelectorAll('.document-detail-file'));
        fileInputs.forEach(input => {
            if (input && input.files && input.files[0]) {
                formData.append(input.name, input.files[0]);
            }
        });

        const response = await fetch('/submit-request', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const result = await response.json();
            showAlert(`Request created! ID: ${result.request_id}`, 'success');
            document.getElementById('guestRequestForm').reset();
            document.getElementById('selectedSlotId').value = '';
            updateGuestFilePreview();
            closeModal('requestModal');
            loadRecentRequests();
            loadAvailableSlots();
        } else {
            const body = await response.json();
            showAlert(body.error || 'Unable to submit request', 'danger');
        }
    } catch (error) {
        console.error('Error submitting guest request:', error);
        showAlert('Unable to submit request', 'danger');
    }
}

// Load available appointment slots for booking
async function loadAvailableSlots() {
    try {
        const response = await fetch('/api/schedule/slots');
        const slots = await response.json();
        const slotsDiv = document.getElementById('availableSlots');

        const renderSlots = (container, selectable) => {
            if (!container) return;
            if (slots.length === 0) {
                container.innerHTML = '<p>No available slots at this time.</p>';
                return;
            }
            container.innerHTML = '';
            slots.forEach(slot => {
                const slotCard = document.createElement('div');
                slotCard.className = 'slot-card';
                slotCard.innerHTML = `
                    <div>
                        <strong>${new Date(slot.date).toLocaleDateString()}</strong>
                        <p>${slot.time_slot}</p>
                    </div>
                `;
                container.appendChild(slotCard);
            });
        };

        renderSlots(slotsDiv, false);
        renderPickupSlotCalendar(slots);
    } catch (error) {
        console.error('Error loading available slots:', error);
        showAlert('Error loading appointment slots', 'danger');
    }
}

function selectSlot(slotId, date, timeSlot) {
    const slotInput = document.getElementById('selectedSlotId');
    const selectedInfo = document.getElementById('selectedSlotInfo');
    if (slotInput) {
        slotInput.value = slotId;
    }
    if (selectedInfo) {
        selectedInfo.textContent = `Selected pickup: ${new Date(date).toLocaleDateString()} · ${timeSlot}`;
    }

    document.querySelectorAll('#modalSlotCalendar button').forEach(button => {
        button.classList.toggle('selected', button.dataset.slotId === String(slotId));
    });
}

function renderPickupSlotCalendar(slots) {
    const calendarContainer = document.getElementById('modalSlotCalendar');
    if (!calendarContainer) return;
    if (!slots || slots.length === 0) {
        calendarContainer.innerHTML = '<p>No available slots at this time.</p>';
        return;
    }

    const slotsByDate = slots.reduce((map, slot) => {
        const dateKey = slot.date;
        if (!map[dateKey]) map[dateKey] = [];
        map[dateKey].push(slot);
        return map;
    }, {});

    const sortedDates = Object.keys(slotsByDate).sort();
    calendarContainer.innerHTML = sortedDates.map(date => `
        <div class="pickup-calendar-day">
            <div class="pickup-calendar-date">${new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div class="pickup-calendar-slots">
                ${slotsByDate[date].map(slot => `
                    <button type="button" class="btn btn-sm slot-calendar-button" data-slot-id="${slot.slot_id}" data-date="${slot.date}" data-time-slot="${slot.time_slot}" onclick="selectSlot(${slot.slot_id}, '${slot.date}', '${slot.time_slot}')">
                        ${slot.time_slot}
                    </button>
                `).join('')}
            </div>
        </div>
    `).join('');
}

// Load recent guest requests
async function loadRecentRequests() {
    try {
        const response = await fetch('/api/guest-requests');
        const requests = await response.json();
        const container = document.getElementById('recentRequests');

        if (!container) return;
        if (requests.length === 0) {
            container.innerHTML = '<p>No requests submitted yet.</p>';
            return;
        }

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Request ID</th>
                        <th>Document</th>
                        <th>Status</th>
                        <th>Pickup</th>
                        <th>Document</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>
                    ${requests.map(req => `
                        <tr>
                            <td>${req.request_id}</td>
                            <td>${req.document_name}</td>
                            <td><span class="badge badge-${req.status.toLowerCase()}">${req.status}</span></td>
                            <td>${req.appointment_date ? `${new Date(req.appointment_date).toLocaleDateString()} · ${req.time_slot}` : 'Not scheduled'}</td>
                            <td>${req.digital_file_url ? `<a class="btn btn-sm btn-primary" href="${escapeHtml(req.digital_file_url)}">Download</a>` : 'N/A'}</td>
                            <td>${new Date(req.created_at).toLocaleDateString()}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading recent requests:', error);
        showAlert('Unable to load recent requests', 'danger');
    }
}

async function loadEvents() {
    const container = document.getElementById('eventsContainer');
    if (!container) return;

    try {
        const events = await fetchJson('/api/events');
        renderEventsCalendar(container, events);
    } catch (error) {
        console.error('Error loading events:', error);
        container.innerHTML = '<p>Unable to load events.</p>';
    }
}

function renderEventsCalendar(container, events) {
    if (!container) return;

    const eventMap = events.reduce((map, event) => {
        const key = event.date;
        map[key] = map[key] || [];
        map[key].push(event);
        return map;
    }, {});
    const monthDate = events.length > 0 ? new Date(events[0].date) : new Date();
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const monthName = monthDate.toLocaleString('default', { month: 'long' });
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let calendarHtml = `<div class="calendar-header"><h4>${monthName} ${year}</h4></div><div class="calendar-grid">`;
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
        calendarHtml += `<div class="calendar-day">${day}</div>`;
    });
    for (let i = 0; i < firstDay; i++) {
        calendarHtml += '<div class="calendar-cell empty"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEvents = eventMap[dateKey] || [];
        calendarHtml += `<div class="calendar-cell"><div class="calendar-date">${day}</div>`;
        if (dayEvents.length > 0) {
            calendarHtml += '<div class="calendar-announcements">';
            dayEvents.forEach(event => {
                const details = [event.time, event.location].filter(Boolean).join(' - ');
                calendarHtml += `<div class="calendar-item"><strong>${escapeHtml(event.title)}</strong><div>${escapeHtml(details)}</div></div>`;
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
    if (events.length === 0) {
        calendarHtml += '<div class="calendar-empty-message">No events scheduled yet.</div>';
    }
    container.innerHTML = calendarHtml;
}

async function loadAnnouncements() {
    const calendarContainer = document.getElementById('announcementsCalendar');
    const listContainer = document.getElementById('announcementsList');
    if (!calendarContainer && !listContainer) return;

    try {
        const announcements = await fetchJson('/api/announcements');
        renderAnnouncementCalendar(calendarContainer, announcements);
        renderAnnouncementList(listContainer, announcements);
    } catch (error) {
        console.error('Error loading announcements:', error);
        if (calendarContainer) calendarContainer.innerHTML = '<p>Unable to load announcements.</p>';
        if (listContainer) listContainer.innerHTML = '<p>Unable to load announcements.</p>';
    }
}

function renderAnnouncementCalendar(container, items) {
    if (!container) return;

    const announcementMap = items.reduce((map, announcement) => {
        const key = announcement.date;
        map[key] = map[key] || [];
        map[key].push(announcement);
        return map;
    }, {});
    const monthDate = items.length > 0 ? new Date(items[0].date) : new Date();
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const monthName = monthDate.toLocaleString('default', { month: 'long' });
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let calendarHtml = `<div class="calendar-header"><h4>${monthName} ${year}</h4></div><div class="calendar-grid">`;
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
        calendarHtml += `<div class="calendar-day">${day}</div>`;
    });
    for (let i = 0; i < firstDay; i++) {
        calendarHtml += '<div class="calendar-cell empty"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayAnnouncements = announcementMap[dateKey] || [];
        calendarHtml += `<div class="calendar-cell"><div class="calendar-date">${day}</div>`;
        if (dayAnnouncements.length > 0) {
            calendarHtml += '<div class="calendar-announcements">';
            dayAnnouncements.forEach(item => {
                calendarHtml += `<div class="calendar-item"><strong>${escapeHtml(item.title)}</strong><div>${escapeHtml(item.message)}</div></div>`;
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
    if (items.length === 0) {
        calendarHtml += '<div class="calendar-empty-message">No announcements scheduled for this month.</div>';
    }
    container.innerHTML = calendarHtml;
}

function renderAnnouncementList(container, items) {
    if (!container) return;
    if (items.length === 0) {
        container.innerHTML = '<p>No announcements right now.</p>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="announcement-item">
            <h5>${escapeHtml(item.title)}</h5>
            <p>${escapeHtml(item.message)}</p>
            <small>${escapeHtml(item.date)}</small>
        </div>
    `).join('');
}

async function submitRequest(event) {
    event.preventDefault();

    const documentId = document.getElementById('documentSelect').value;
    const deliveryMethod = document.getElementById('deliveryMethod')?.value || 'Physical';
    const fileInput = document.getElementById('digitalDocumentUpload');
    const file = fileInput?.files?.[0];
    const selectedDocument = documentsCache[documentId];

    if (!documentId) {
        showAlert('Please select a document', 'warning');
        return;
    }

    if (deliveryMethod === 'Digital' && !selectedDocument?.is_digital_available) {
        showAlert('This document does not support digital delivery. Please choose Physical.', 'warning');
        return;
    }

    if (deliveryMethod === 'Digital' && !file) {
        showAlert('Please upload a supporting document for digital delivery.', 'warning');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('document_id', documentId);
        formData.append('delivery_method', deliveryMethod);
        if (file) {
            formData.append('digital_document', file);
        }
        // Include any requirement file inputs
        const reqFiles = document.querySelectorAll('.requirement-file');
        reqFiles.forEach(input => {
            if (input && input.files && input.files[0]) {
                formData.append(input.name, input.files[0]);
            }
        });

        const response = await fetch('/resident/submit-request', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Error submitting request');

        showAlert('Request submitted successfully!', 'success');
        document.getElementById('requestForm').reset();
        updateFileUploadVisibility();
        await loadResidentRequests();
    } catch (error) {
        console.error('Error submitting request:', error);
        showAlert(error.message || 'Error submitting request', 'danger');
    }
}

async function uploadResidentDigitalDocument(requestId) {
    const input = document.getElementById(`residentDigitalDocument-${requestId}`);
    const file = input?.files?.[0];
    if (!file) {
        showAlert('Please choose a digital document to upload.', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('digital_document', file);

    try {
        const response = await fetch(`/api/requests/${requestId}/digital-document`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to upload digital document');
        showAlert(result.message, 'success');
        await loadResidentRequests();
    } catch (error) {
        console.error(error);
        showAlert(error.message || 'Unable to upload digital document', 'danger');
    }
}

async function loadResidentRequests() {
    const tableBody = document.getElementById('residentRequestsBody');
    const requestSelect = document.getElementById('requestIdForAppointment');
    if (!tableBody && !requestSelect) return;

    try {
        const requests = await fetchJson('/api/resident/requests');
        if (tableBody) {
            if (requests.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="6">No requests submitted yet.</td></tr>';
            } else {
                tableBody.innerHTML = requests.map(req => `
                    <tr>
                        <td>${req.request_id}</td>
                        <td>${escapeHtml(req.document_name)}</td>
                        <td>${escapeHtml(req.delivery_method)}</td>
                        <td><span class="badge badge-${escapeHtml(req.status.toLowerCase())}">${escapeHtml(req.status)}</span></td>
                        <td>${req.digital_file_url ? `<a class="btn btn-sm btn-primary" href="${escapeHtml(req.digital_file_url)}">Download</a>` : 'N/A'}</td>
                        <td>${formatDate(req.created_at)}</td>
                    </tr>
                `).join('');
            }
        }
        if (requestSelect) {
            const currentValue = requestSelect.value;
            requestSelect.innerHTML = '<option value="">Select a request</option>' + requests.map(req => `
                <option value="${req.request_id}">${req.request_id} - ${escapeHtml(req.document_name)} (${escapeHtml(req.status)})</option>
            `).join('');
            requestSelect.value = currentValue;
        }
    } catch (error) {
        console.error('Error loading resident requests:', error);
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="6">Unable to load requests.</td></tr>';
    }
}

async function loadAppointmentSlots() {
    const slotsDiv = document.getElementById('appointmentSlots');
    if (!slotsDiv) return;

    try {
        const slots = await fetchJson('/api/schedule/slots');
        if (slots.length === 0) {
            slotsDiv.innerHTML = '<p>No available slots at this time.</p>';
            return;
        }
        slotsDiv.innerHTML = slots.map(slot => `
            <div class="slot-card">
                <div>
                    <strong>${formatDate(slot.date)}</strong>
                    <p>${escapeHtml(slot.time_slot)}</p>
                </div>
                <button type="button" class="btn btn-sm btn-primary" onclick="bookResidentSlot(${slot.slot_id})">Select</button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading appointment slots:', error);
        slotsDiv.innerHTML = '<p>Unable to load appointment slots.</p>';
    }
}

async function bookResidentSlot(slotId) {
    const requestId = document.getElementById('requestIdForAppointment').value;

    if (!requestId) {
        showAlert('Please select a request first', 'warning');
        return;
    }

    try {
        await fetchJson('/resident/book-appointment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_id: requestId, slot_id: slotId })
        });
        showAlert('Appointment booked successfully!', 'success');
        await Promise.all([loadResidentRequests(), loadAppointmentSlots()]);
    } catch (error) {
        console.error('Error booking appointment:', error);
        showAlert(error.message || 'Error booking appointment', 'danger');
    }
}

function startDashboardPolling() {
    const refreshers = [];
    if (document.getElementById('eventsContainer')) refreshers.push(loadEvents);
    if (document.getElementById('announcementsCalendar') || document.getElementById('announcementsList')) refreshers.push(loadAnnouncements);
    if (document.getElementById('residentRequestsBody') || document.getElementById('requestIdForAppointment')) refreshers.push(loadResidentRequests);
    if (document.getElementById('recentRequests')) refreshers.push(loadRecentRequests);

    if (refreshers.length > 0) {
        setInterval(() => {
            refreshers.forEach(refresh => refresh());
        }, 5000);
    }
}

// Existing login/register handler
async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email, password })
        });

        const loginData = await response.json();
        if (response.ok) {
            if (loginData.redirect_to) {
                window.location.href = loginData.redirect_to;
                return;
            }
            window.location.href = '/resident/dashboard';
        } else {
            showAlert(loginData.error || 'Invalid email or password', 'danger');
        }
    } catch (error) {
        console.error('Error:', error);
        showAlert('Login error', 'danger');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const contact = document.getElementById('contact').value;
    const address = document.getElementById('address').value;

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                email,
                password,
                contact_number: contact,
                address
            })
        });

        const registerData = await response.json();
        if (response.status === 201) {
            showAlert('Registration successful! Redirecting to login...', 'success');
            setTimeout(() => {
                window.location.href = '/login';
            }, 2000);
        } else if (response.status === 409) {
            showAlert(registerData.error || 'Email already exists', 'danger');
        } else {
            showAlert(registerData.error || 'Registration error', 'danger');
        }
    } catch (error) {
        console.error('Error:', error);
        showAlert('Registration error', 'danger');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }

    const documentSelect = document.getElementById('documentSelect');
    if (documentSelect) {
        loadDocuments();
        documentSelect.addEventListener('change', function() {
            loadRequirements(this.value);
        });
    }

        const guestRequestForm = document.getElementById('guestRequestForm');
        if (guestRequestForm) {
            guestRequestForm.addEventListener('reset', () => {
                const previewGroup = document.getElementById('guestFilePreviewGroup');
                const previewContainer = document.getElementById('guestFilePreview');
                if (previewGroup) previewGroup.hidden = true;
                if (previewContainer) previewContainer.innerHTML = '<p style="margin:0;color:#555;">No files selected yet.</p>';
            });
        }

    if (document.getElementById('modalSlotCalendar') || document.getElementById('modalSlotList') || document.getElementById('availableSlots')) {
        loadAvailableSlots();
    }

    if (document.getElementById('appointmentSlots')) {
        loadAppointmentSlots();
    }

    if (document.getElementById('eventsContainer')) {
        loadEvents();
    }

    if (document.getElementById('announcementsCalendar') || document.getElementById('staffAnnouncementsList')) {
        loadAnnouncements();
    }

    if (document.getElementById('staffEventsCalendar')) {
        loadStaffEvents();
    }

    const addEventForm = document.getElementById('addEventForm');
    if (addEventForm) {
        addEventForm.addEventListener('submit', addStaffEvent);
    }

    const addAnnouncementForm = document.getElementById('addAnnouncementForm');
    if (addAnnouncementForm) {
        addAnnouncementForm.addEventListener('submit', createStaffAnnouncement);
    }

    if (document.getElementById('recentRequests')) {
        loadRecentRequests();
    }

    if (document.getElementById('residentRequestsBody') || document.getElementById('requestIdForAppointment')) {
        loadResidentRequests();
    }

    if (document.getElementById('totalResidents')) {
        fetch('/api/admin/metrics')
            .then(response => response.json())
            .then(metrics => {
                document.getElementById('totalResidents').textContent = metrics.total_residents;
                document.getElementById('totalRequests').textContent = metrics.total_requests;
                document.getElementById('pendingRequests').textContent = metrics.pending_requests;
            });
    }

    startDashboardPolling();
});
