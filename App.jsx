import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'

function useToast() {
  const [msg, setMsg] = useState('')
  const [show, setShow] = useState(false)
  const timer = useRef(null)
  const toast = useCallback((text) => {
    setMsg(text)
    setShow(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setShow(false), 2200)
  }, [])
  return { msg, show, toast }
}

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [booting, setBooting] = useState(true)
  const { msg, show, toast } = useToast()

  // Bootstrap session + subscribe to auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooting(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Load profile row whenever session changes
  useEffect(() => {
    if (!session) { setProfile(null); return }
    let cancelled = false
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setProfile(data) })
    return () => { cancelled = true }
  }, [session])

  if (booting) {
    return <div className="app-shell"><div className="empty" style={{ paddingTop: 100 }}>Loading…</div></div>
  }
  if (!session) return <AuthScreen toast={toast} />
  if (!profile) return <CompleteProfile session={session} onDone={setProfile} />
  return <MainApp session={session} profile={profile} toast={toast} msg={msg} show={show} />
}

/* ---------------- Auth ---------------- */

function AuthScreen({ toast }) {
  const [mode, setMode] = useState('signup') // 'signup' | 'login'
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError('')
    if (!email || !password || (mode === 'signup' && (!name || !phone))) {
      setError('Please fill in all fields.'); return
    }
    setBusy(true)
    if (mode === 'signup') {
      const { data, error: signErr } = await supabase.auth.signUp({ email, password })
      if (signErr) { setError(signErr.message); setBusy(false); return }
      // If email confirmation is off, we get a session immediately and can save the profile now.
      if (data.session) {
        await supabase.from('profiles').insert({ id: data.user.id, name, phone })
      } else {
        toast('Check your email to confirm your account, then log in.')
      }
    } else {
      const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password })
      if (loginErr) { setError(loginErr.message); setBusy(false); return }
    }
    setBusy(false)
  }

  return (
    <div className="app-shell setup-wrap">
      <div className="app-header">
        <div>
          <h1>Co<span>path</span></h1>
          <div className="tagline">Find someone heading your way — split the ride.</div>
        </div>
      </div>
      <div className="card setup-card">
        <p className="intro">
          {mode === 'signup'
            ? 'Create an account. Your contact details are only shown to someone else after you both accept a request.'
            : 'Welcome back.'}
        </p>
        {mode === 'signup' && (
          <>
            <label>Your name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Aditi Rao" />
            <label>Phone number</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Shown only after a request is accepted" />
          </>
        )}
        <label>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
        <label>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" />
        {error && <div className="field-error">{error}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={busy} onClick={submit}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
        </button>
        <div className="auth-switch">
          {mode === 'signup' ? (
            <>Already have an account? <button onClick={() => setMode('login')}>Log in</button></>
          ) : (
            <>New here? <button onClick={() => setMode('signup')}>Create an account</button></>
          )}
        </div>
      </div>
    </div>
  )
}

function CompleteProfile({ session, onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name || !phone) { setError('Both fields are required.'); return }
    setBusy(true)
    const { data, error: insErr } = await supabase
      .from('profiles')
      .insert({ id: session.user.id, name, phone })
      .select()
      .single()
    setBusy(false)
    if (insErr) { setError(insErr.message); return }
    onDone(data)
  }

  return (
    <div className="app-shell setup-wrap">
      <div className="app-header">
        <div>
          <h1>Co<span>path</span></h1>
          <div className="tagline">One last step.</div>
        </div>
      </div>
      <div className="card setup-card">
        <p className="intro">Your email is confirmed — finish setting up your profile.</p>
        <label>Your name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Aditi Rao" />
        <label>Phone number</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Shown only after a request is accepted" />
        {error && <div className="field-error">{error}</div>}
        <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}

/* ---------------- Main app ---------------- */

function MainApp({ session, profile, toast, msg, show }) {
  const me = { id: session.user.id, name: profile.name, phone: profile.phone }
  const [tab, setTab] = useState('browse')
  const [trips, setTrips] = useState([])
  const [requests, setRequests] = useState([])
  const [contacts, setContacts] = useState({}) // userId -> {name, phone}
  const [search, setSearch] = useState('')

  const loadTrips = useCallback(async () => {
    const { data } = await supabase.from('trips').select('*').order('created_at', { ascending: false })
    setTrips(data || [])
  }, [])

  const loadRequests = useCallback(async () => {
    const { data } = await supabase.from('requests').select('*')
      .or(`poster_id.eq.${me.id},requester_id.eq.${me.id}`)
    setRequests(data || [])
  }, [me.id])

  useEffect(() => { loadTrips(); loadRequests() }, [loadTrips, loadRequests])

  // Realtime: refresh on any change to trips / requests
  useEffect(() => {
    const channel = supabase.channel('copath-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, loadTrips)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, loadRequests)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [loadTrips, loadRequests])

  const fetchContact = useCallback(async (userId) => {
    if (contacts[userId]) return
    const { data } = await supabase.from('profiles').select('name, phone').eq('id', userId).maybeSingle()
    if (data) setContacts(prev => ({ ...prev, [userId]: data }))
  }, [contacts])

  // Fetch contacts for anyone we have an accepted request with
  useEffect(() => {
    requests.filter(r => r.status === 'accepted').forEach(r => {
      const otherId = r.poster_id === me.id ? r.requester_id : r.requester_id === me.id ? r.poster_id : null
      const target = r.poster_id === me.id ? r.requester_id : r.poster_id
      fetchContact(target)
    })
  }, [requests, me.id, fetchContact])

  async function postTrip(fields) {
    const { error } = await supabase.from('trips').insert({
      poster_id: me.id, poster_name: me.name,
      destination: fields.destination, date: fields.date, time: fields.time,
      seats: Number(fields.seats) || 1, notes: fields.notes || null
    })
    if (error) { toast(error.message); return }
    toast('Trip posted')
    setTab('browse')
    loadTrips()
  }

  async function sendRequest(trip) {
    const { error } = await supabase.from('requests').insert({
      trip_id: trip.id, poster_id: trip.poster_id,
      requester_id: me.id, requester_name: me.name, status: 'pending'
    })
    if (error) { toast(error.message); return }
    toast('Request sent to ' + trip.poster_name)
    loadRequests()
  }

  async function setStatus(requestId, status) {
    const { error } = await supabase.from('requests').update({ status }).eq('id', requestId)
    if (error) { toast(error.message); return }
    if (status === 'accepted') toast('Request accepted — contact details shared')
    loadRequests()
  }

  async function removeTrip(tripId) {
    await supabase.from('trips').delete().eq('id', tripId)
    loadTrips()
  }

  async function signOut() { await supabase.auth.signOut() }

  const receivedCount = requests.filter(r => r.poster_id === me.id && r.status === 'pending').length

  return (
    <div className="app-shell">
      <div className="app-header">
        <div>
          <h1>Co<span>path</span></h1>
          <div className="tagline">Find someone heading your way — split the ride.</div>
        </div>
        <button className="signout" onClick={signOut}>Sign out</button>
      </div>
      <div className="tabs">
        <button className={`tab-btn ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>Browse</button>
        <button className={`tab-btn ${tab === 'post' ? 'active' : ''}`} onClick={() => setTab('post')}>Post a trip</button>
        <button className={`tab-btn ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>
          My activity{receivedCount > 0 && <span className="badge">{receivedCount}</span>}
        </button>
      </div>

      {tab === 'browse' && (
        <Browse me={me} trips={trips} requests={requests} contacts={contacts}
          search={search} setSearch={setSearch} onRequest={sendRequest} />
      )}
      {tab === 'post' && <PostTrip onSubmit={postTrip} />}
      {tab === 'activity' && (
        <Activity me={me} trips={trips} requests={requests} contacts={contacts}
          onAccept={id => setStatus(id, 'accepted')} onReject={id => setStatus(id, 'rejected')}
          onRemoveTrip={removeTrip} />
      )}

      <div className={`toast ${show ? 'show' : ''}`}>{msg}</div>
    </div>
  )
}

function Browse({ me, trips, requests, contacts, search, setSearch, onRequest }) {
  const q = search.trim().toLowerCase()
  const list = trips.filter(t => t.poster_id !== me.id && (!q || t.destination.toLowerCase().includes(q)))

  return (
    <>
      <input className="search-bar" placeholder="Search by destination…" value={search} onChange={e => setSearch(e.target.value)} />
      {list.length === 0 ? (
        <div className="empty"><div className="dest">No trips posted yet</div><p>Be the first — post where you're headed and let others join in.</p></div>
      ) : list.map(t => {
        const myReq = requests.find(r => r.trip_id === t.id && r.requester_id === me.id)
        return (
          <div className="card" key={t.id}>
            <div className="route"><div className="dot"></div><div className="line"></div><div className="dot end"></div></div>
            <div className="route-labels"><span>Meet-up point</span><span>Destination</span></div>
            <div className="dest">{t.destination}</div>
            <div className="meta-row">
              <div className="item">📅 {t.date}</div>
              <div className="item">🕒 {t.time}</div>
              <div className="item">👥 {t.seats} seat(s) open</div>
            </div>
            {t.notes && <div className="notes">{t.notes}</div>}
            <div className="poster">Posted by <b>{t.poster_name}</b></div>
            {!myReq && <button className="btn btn-primary" onClick={() => onRequest(t)}>Request to join</button>}
            {myReq && myReq.status === 'pending' && <span className="pill pill-pending">Request sent — waiting</span>}
            {myReq && myReq.status === 'accepted' && (
              <>
                <span className="pill pill-accepted">Accepted</span>
                <div className="contact-box">
                  <div className="label">Call or message {t.poster_name}</div>
                  <div>{contacts[t.poster_id]?.phone || 'Loading…'}</div>
                </div>
              </>
            )}
            {myReq && myReq.status === 'rejected' && <span className="pill pill-rejected">Not accepted</span>}
          </div>
        )
      })}
    </>
  )
}

function PostTrip({ onSubmit }) {
  const [destination, setDestination] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [seats, setSeats] = useState('1')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  function submit() {
    if (!destination || !date || !time) { setError('Fill in destination, date and time'); return }
    setError('')
    onSubmit({ destination, date, time, seats, notes })
    setDestination(''); setDate(''); setTime(''); setSeats('1'); setNotes('')
  }

  return (
    <div className="card">
      <label>Where are you headed?</label>
      <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="e.g. Aluva Metro Station" />
      <div className="two-col">
        <div><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><label>Time</label><input type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
      </div>
      <label>Seats open (besides you)</label>
      <input type="number" min="1" max="6" value={seats} onChange={e => setSeats(e.target.value)} />
      <label>Notes (optional)</label>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Leaving from the north gate, prefer Uber/Rapido shared" />
      {error && <div className="field-error">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} onClick={submit}>Post trip</button>
    </div>
  )
}

function Activity({ me, trips, requests, contacts, onAccept, onReject, onRemoveTrip }) {
  const myTrips = trips.filter(t => t.poster_id === me.id)
  const received = requests.filter(r => r.poster_id === me.id)
  const sent = requests.filter(r => r.requester_id === me.id)

  return (
    <>
      <div className="section-label">Requests for your trips</div>
      {received.length === 0 ? (
        <div className="empty" style={{ padding: '30px 20px' }}><p>No one has requested to join your trips yet.</p></div>
      ) : received.map(r => {
        const trip = trips.find(t => t.id === r.trip_id)
        return (
          <div className="card" key={r.id}>
            <div className="dest" style={{ fontSize: 19 }}>{trip ? trip.destination : '(trip removed)'}</div>
            <div className="meta-row"><div className="item">Request from <b style={{ color: 'var(--text)' }}>{r.requester_name}</b></div></div>
            {r.status === 'pending' && (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-accept btn-sm" onClick={() => onAccept(r.id)}>Accept</button>
                <button className="btn btn-reject btn-sm" onClick={() => onReject(r.id)}>Reject</button>
              </div>
            )}
            {r.status === 'accepted' && (
              <>
                <span className="pill pill-accepted">Accepted</span>
                <div className="contact-box">
                  <div className="label">Call or message {r.requester_name}</div>
                  <div>{contacts[r.requester_id]?.phone || 'Loading…'}</div>
                </div>
              </>
            )}
            {r.status === 'rejected' && <span className="pill pill-rejected">Rejected</span>}
          </div>
        )
      })}

      <div className="section-label">Your sent requests</div>
      {sent.length === 0 ? (
        <div className="empty" style={{ padding: '30px 20px' }}><p>You haven't requested to join any trips yet.</p></div>
      ) : sent.map(r => {
        const trip = trips.find(t => t.id === r.trip_id)
        return (
          <div className="card" key={r.id}>
            <div className="dest" style={{ fontSize: 19 }}>{trip ? trip.destination : '(trip removed)'}</div>
            {r.status === 'pending' && <span className="pill pill-pending">Waiting for response</span>}
            {r.status === 'rejected' && <span className="pill pill-rejected">Not accepted</span>}
            {r.status === 'accepted' && (
              <>
                <span className="pill pill-accepted">Accepted</span>
                <div className="contact-box">
                  <div className="label">Call or message {trip ? trip.poster_name : ''}</div>
                  <div>{contacts[r.poster_id]?.phone || 'Loading…'}</div>
                </div>
              </>
            )}
          </div>
        )
      })}

      <div className="section-label">Trips you posted</div>
      {myTrips.length === 0 ? (
        <div className="empty" style={{ padding: '30px 20px' }}><p>You haven't posted a trip yet.</p></div>
      ) : myTrips.map(t => (
        <div className="card" key={t.id}>
          <div className="dest" style={{ fontSize: 19 }}>{t.destination}</div>
          <div className="meta-row"><div className="item">📅 {t.date}</div><div className="item">🕒 {t.time}</div></div>
          <button className="btn btn-reject btn-sm" onClick={() => onRemoveTrip(t.id)}>Remove trip</button>
        </div>
      ))}
    </>
  )
}
