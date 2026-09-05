let currentSession = null;
let timerInterval = null;
let checkinInterval = null;
let checkinTimeout = null;
let sessionStartTime = null;
const stateIdle = document.getElementById('state-idle');
const stateTypeSelect = document.getElementById('state-type-select');
const stateActive = document.getElementById('state-active');
const webcamContainer = document.getElementById('webcam-container');
const webcam = document.getElementById('webcam');
const canvas = document.getElementById('canvas');
const checkinPopup = document.getElementById('checkin-popup');
const checkinNote = document.getElementById('checkin-note');
const checkinUpdateForm = document.getElementById('checkin-update-form');
const checkinNewNote = document.getElementById('checkin-new-note');
const sessionsList = document.getElementById('sessions-list');
const activeTimer = document.getElementById('active-timer');
const activeType = document.getElementById('active-type');
const activeNote = document.getElementById('active-note');
const skipFaceCheck = document.getElementById('skip-face-check');
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}
function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/static/icon.png' });
    }
}
async function api(path, options = {}) {
    const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Request failed' }));
        throw new Error(err.detail || 'Request failed');
    }
    return res.json();
}
function showState(state) {
    [stateIdle, stateTypeSelect, stateActive].forEach(el => el.classList.add('hidden'));
    state.classList.remove('hidden');
}
async function startWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        webcam.srcObject = stream;
        webcamContainer.classList.remove('hidden');
        await new Promise(r => webcam.onloadedmetadata = r);
        await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
        alert('Camera access denied or not available');
        throw e;
    }
}
function stopWebcam() {
    if (webcam.srcObject) {
        webcam.srcObject.getTracks().forEach(t => t.stop());
        webcam.srcObject = null;
    }
    webcamContainer.classList.add('hidden');
}
function captureFrame() {
    canvas.width = webcam.videoWidth;
    canvas.height = webcam.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(webcam, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7);
}
async function doFaceCheck() {
    const frame = captureFrame();
    const res = await api('/clock-in', {
        method: 'POST',
        body: JSON.stringify({ frame }),
    });
    return res.face_detected;
}
async function loadCurrentSession() {
    const res = await api('/session/current');
    currentSession = res.session;
    if (currentSession) {
        sessionStartTime = new Date(currentSession.start_time);
        showState(stateActive);
        updateActiveUI();
        startTimer();
        startCheckinTimer();
        requestNotificationPermission();
    } else {
        showState(stateIdle);
    }
    loadSessions();
}
function updateActiveUI() {
    if (!currentSession) return;
    activeType.textContent = currentSession.type;
    activeType.className = 'badge ' + currentSession.type.toLowerCase();
    activeNote.textContent = currentSession.note || '(no note)';
}
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!sessionStartTime) return;
        const diff = Date.now() - sessionStartTime.getTime();
        const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
        activeTimer.textContent = `${h}:${m}:${s}`;
    }, 1000);
}
async function startCheckinTimer() {
    const res = await api('/checkin/interval');
    const intervalMs = res.interval_min * 60 * 1000;
    
    if (checkinInterval) clearInterval(checkinInterval);
    
    checkinInterval = setInterval(() => {
        if (currentSession) {
            showCheckinPopup();
        }
    }, intervalMs);
}
function showCheckinPopup() {
    checkinNote.textContent = currentSession.note || '(no note)';
    checkinUpdateForm.classList.add('hidden');
    checkinNewNote.value = '';
    checkinPopup.classList.remove('hidden');
    showNotification('Focus Logger Check-in', `Still on: ${currentSession.note || '(no note)'}?`);
    
    if (checkinTimeout) clearTimeout(checkinTimeout);
    checkinTimeout = setTimeout(() => {
        handleCheckin('unconfirmed', currentSession.note);
    }, 60000);
}
function hideCheckinPopup() {
    checkinPopup.classList.add('hidden');
    if (checkinTimeout) clearTimeout(checkinTimeout);
}
async function handleCheckin(status, note) {
    if (!currentSession) return;
    hideCheckinPopup();
    await api('/session/checkin', {
        method: 'POST',
        body: JSON.stringify({
            session_id: currentSession.session_id,
            status,
            note,
        }),
    });
    loadSessions();
}
async function loadSessions() {
    const res = await api('/sessions/today');
    sessionsList.innerHTML = ''; 
    const countBadge = document.getElementById('session-count');
    if (countBadge) countBadge.textContent = res.sessions.length;
    if (res.sessions.length === 0) {
        sessionsList.innerHTML = `
            <div class="empty-state">
                <p>No sessions today</p>
                <p style="font-size:0.9rem;margin-top:0.5rem;opacity:0.5;">Clock in to begin your first session</p>
            </div>
        `;
        return;
    }
    const recentSessions = res.sessions.slice(-4).reverse();
    for (const session of recentSessions) {
        const div = document.createElement('div');
        div.className = 'session-item';    
        const start = new Date(session.start_time);
        const end = session.end_time ? new Date(session.end_time) : null;
        const timeStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + 
            ' – ' + (end ? end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'ongoing');
        
        let checkinsHtml = '';
        try {
            const checkinRes = await api(`/session/${session.session_id}/checkins`);
            if (checkinRes.checkins && checkinRes.checkins.length > 0) {
                checkinsHtml = '<div class="checkin-list">' + checkinRes.checkins.map(c => `
                    <div class="checkin-item ${c.status}">
                        <strong>${new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                        <span style="margin-left:0.75rem;">${c.status === 'updated' ? '→ ' + c.note : c.note}</span>
                        <span style="margin-left:0.5rem;opacity:0.5;font-size:0.75rem;text-transform:uppercase;">${c.status}</span>
                    </div>
                `).join('') + '</div>';
            }
        } catch (e) {
            console.warn('Could not load checkins for session', session.session_id);
        }
        div.innerHTML = `
            <div class="session-item-header">
                <span class="session-item-time">${timeStr}</span>
                <span class="session-item-type ${session.type.toLowerCase()}">${session.type}</span>
            </div>
            <div class="session-item-note">${session.note || '(no note)'}</div>
            ${session.end_time ? `<div class="session-item-duration">${session.duration_min.toFixed(1)} min</div>` : ''}
            ${checkinsHtml}
        `;
        sessionsList.appendChild(div);
    }
    if (res.sessions.length > 4) {
        const moreDiv = document.createElement('div');
        moreDiv.className = 'empty-state';
        moreDiv.style.padding = '1rem';
        moreDiv.innerHTML = `<p style="font-size:0.85rem;">+ ${res.sessions.length - 4} more session${res.sessions.length - 4 > 1 ? 's' : ''} today</p>`;
        sessionsList.appendChild(moreDiv);
    }
}
document.getElementById('btn-clock-in').addEventListener('click', async () => {
    try {
        await startWebcam();
        const detected = await doFaceCheck();
        stopWebcam();
        if (!detected) {
            alert('No face detected. Please try again.');
            return;
        }
        showState(stateTypeSelect);
    } catch (e) {
        console.error(e);
    }
});
document.getElementById('btn-start-session').addEventListener('click', async () => {
    const type = document.getElementById('session-type').value;
    const note = document.getElementById('session-note').value.trim(); 
    if (!note) {
        alert('Please enter a note');
        return;
    }
    const res = await api('/session/start', {
        method: 'POST',
        body: JSON.stringify({ type, note }),
    });
    currentSession = {
        session_id: res.session_id,
        start_time: res.start_time,
        type,
        note,
    };
    sessionStartTime = new Date(res.start_time);
    showState(stateActive);
    updateActiveUI();
    startTimer();
    startCheckinTimer();
    loadSessions();
    document.getElementById('session-note').value = '';
});
document.getElementById('btn-cancel-type').addEventListener('click', () => {
    showState(stateIdle);
});
document.getElementById('btn-switch').addEventListener('click', async () => {
    try {
        if (!skipFaceCheck.checked) {
            await startWebcam();
            const detected = await doFaceCheck();
            stopWebcam();
            if (!detected) {
                alert('No face detected. Please try again or enable "Skip face check".');
                return;
            }
        }        
        const newType = currentSession.type === 'Studying' ? 'Break' : 'Studying';
        const note = prompt(`Starting ${newType}. Note:`, '') || '';
        const res = await api('/session/start', {
            method: 'POST',
            body: JSON.stringify({ type: newType, note }),
        });
        currentSession = {
            session_id: res.session_id,
            start_time: res.start_time,
            type: newType,
            note,
        };
        sessionStartTime = new Date(res.start_time);
        updateActiveUI();
        loadSessions();
    } catch (e) {
        console.error(e);
    }
});
document.getElementById('btn-end-day').addEventListener('click', async () => {
    if (!confirm('End day and close current session?')) return;
    if (!skipFaceCheck.checked) {
        try {
            await startWebcam();
            const detected = await doFaceCheck();
            stopWebcam();
            if (!detected) {
                alert('No face detected. Please try again or enable "Skip face check".');
                return;
            }
        } catch (e) {
            console.error(e);
            return;
        }
    }
    await api('/session/end-day', { method: 'POST' });
    currentSession = null;
    sessionStartTime = null;
    if (timerInterval) clearInterval(timerInterval);
    if (checkinInterval) clearInterval(checkinInterval);
    showState(stateIdle);
    loadSessions();
});
document.getElementById('btn-checkin-yes').addEventListener('click', () => {
    handleCheckin('confirmed', currentSession.note);
});
document.getElementById('btn-checkin-update').addEventListener('click', () => {
    checkinUpdateForm.classList.remove('hidden');
    checkinNewNote.focus();
});
document.getElementById('btn-checkin-submit').addEventListener('click', () => {
    const newNote = checkinNewNote.value.trim() || currentSession.note;
    handleCheckin('updated', newNote);
});
checkinNewNote.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const newNote = checkinNewNote.value.trim() || currentSession.note;
        handleCheckin('updated', newNote);
    }
});
loadCurrentSession();