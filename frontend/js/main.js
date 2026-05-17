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
    alertDiv.style.maxWidth = '300px';
    
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

// Close modal when clicking outside
document.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
});

// API function to fetch documents
async function loadDocuments() {
    try {
        const response = await fetch('/api/documents');
        const documents = await response.json();
        
        const selectElement = document.getElementById('documentSelect');
        if (selectElement) {
            selectElement.innerHTML = '<option value="">-- Select a document --</option>';
            documents.forEach(doc => {
                const option = document.createElement('option');
                option.value = doc.document_id;
                option.textContent = doc.document_name;
                selectElement.appendChild(option);
            });
        }
        
        return documents;
    } catch (error) {
        console.error('Error loading documents:', error);
        showAlert('Error loading documents', 'danger');
    }
}

// API function to get document requirements
async function loadRequirements(documentId) {
    if (!documentId) return;
    
    try {
        const response = await fetch(`/api/document/${documentId}/requirements`);
        const requirements = await response.json();
        
        const requirementsDiv = document.getElementById('requirementsList');
        if (requirementsDiv) {
            if (requirements.length === 0) {
                requirementsDiv.innerHTML = '<p>No requirements for this document.</p>';
            } else {
                requirementsDiv.innerHTML = '<h4>Required Documents:</h4><ul>';
                requirements.forEach(req => {
                    requirementsDiv.innerHTML += `<li>${req.requirement_name}</li>`;
                });
                requirementsDiv.innerHTML += '</ul>';
            }
        }
    } catch (error) {
        console.error('Error loading requirements:', error);
    }
}

// API function to submit a request
async function submitRequest(event) {
    event.preventDefault();
    
    const documentId = document.getElementById('documentSelect').value;
    const deliveryMethod = document.querySelector('input[name="deliveryMethod"]:checked').value;
    
    if (!documentId) {
        showAlert('Please select a document', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/resident/submit-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                document_id: documentId,
                delivery_method: deliveryMethod
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showAlert('Request submitted successfully!', 'success');
            document.getElementById('requestForm').reset();
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            showAlert('Error submitting request', 'danger');
        }
    } catch (error) {
        console.error('Error:', error);
        showAlert('Error submitting request', 'danger');
    }
}

// API function to load available appointment slots
async function loadAppointmentSlots() {
    try {
        const response = await fetch('/api/schedule/slots');
        const slots = await response.json();
        
        const slotsDiv = document.getElementById('appointmentSlots');
        if (slotsDiv) {
            if (slots.length === 0) {
                slotsDiv.innerHTML = '<p>No available slots at this time.</p>';
            } else {
                slotsDiv.innerHTML = '';
                slots.forEach(slot => {
                    const slotCard = document.createElement('div');
                    slotCard.className = 'slot-card';
                    slotCard.innerHTML = `
                        <div>
                            <strong>${new Date(slot.date).toLocaleDateString()}</strong>
                            <p>${slot.time_slot}</p>
                        </div>
                        <button class="btn btn-sm btn-primary" onclick="selectSlot(${slot.slot_id})">Select</button>
                    `;
                    slotsDiv.appendChild(slotCard);
                });
            }
        }
    } catch (error) {
        console.error('Error loading slots:', error);
        showAlert('Error loading appointment slots', 'danger');
    }
}

// Function to select appointment slot
async function selectSlot(slotId) {
    const requestId = document.getElementById('requestIdForAppointment').value;
    
    if (!requestId) {
        showAlert('Please select a request first', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/resident/book-appointment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                request_id: requestId,
                slot_id: slotId
            })
        });
        
        if (response.ok) {
            showAlert('Appointment booked successfully!', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            showAlert('Error booking appointment', 'danger');
        }
    } catch (error) {
        console.error('Error:', error);
        showAlert('Error booking appointment', 'danger');
    }
}

// API function to update request status (Staff)
async function updateRequestStatus(requestId, newStatus) {
    try {
        const response = await fetch(`/staff/process-request/${requestId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                status: newStatus
            })
        });
        
        if (response.ok) {
            showAlert('Request updated successfully!', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } else {
            showAlert('Error updating request', 'danger');
        }
    } catch (error) {
        console.error('Error:', error);
        showAlert('Error updating request', 'danger');
    }
}

// Load metrics for admin dashboard
async function loadMetrics() {
    try {
        const response = await fetch('/api/admin/metrics');
        const metrics = await response.json();
        
        document.getElementById('totalResidents').textContent = metrics.total_residents;
        document.getElementById('totalRequests').textContent = metrics.total_requests;
        document.getElementById('pendingRequests').textContent = metrics.pending_requests;
    } catch (error) {
        console.error('Error loading metrics:', error);
    }
}

// Login form handler
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email, password })
                });
                
                if (response.ok) {
                    window.location.href = response.redirected ? response.url : '/resident/dashboard';
                } else {
                    showAlert('Invalid email or password', 'danger');
                }
            } catch (error) {
                console.error('Error:', error);
                showAlert('Login error', 'danger');
            }
        });
    }

    // Register form handler
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const contact = document.getElementById('contact').value;
            const address = document.getElementById('address').value;
            
            try {
                const response = await fetch('/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name, email, password,
                        contact_number: contact,
                        address
                    })
                });
                
                if (response.status === 201) {
                    showAlert('Registration successful! Redirecting to login...', 'success');
                    setTimeout(() => {
                        window.location.href = '/login';
                    }, 2000);
                } else if (response.status === 409) {
                    showAlert('Email already exists', 'danger');
                } else {
                    showAlert('Registration error', 'danger');
                }
            } catch (error) {
                console.error('Error:', error);
                showAlert('Registration error', 'danger');
            }
        });
    }

    // Load documents on page load for resident dashboard
    const documentSelect = document.getElementById('documentSelect');
    if (documentSelect) {
        loadDocuments();
        
        documentSelect.addEventListener('change', function() {
            loadRequirements(this.value);
        });
    }

    // Load slots for appointment booking
    const appointmentModal = document.getElementById('appointmentModal');
    if (appointmentModal) {
        loadAppointmentSlots();
    }

    // Load metrics for admin
    if (document.getElementById('totalResidents')) {
        loadMetrics();
    }
});
