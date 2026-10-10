// Home Assistant in Settings → Family (grown-ups' devices): connect it, pick the shown places, show
// where everyone is on wall screens or not, and disconnect; and each member's "Home Assistant person"
// row in their edit sheet. Docs: docs/using/whereabouts.md.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import PickField from './PickField.tsx'
import type { HaPerson, HaZone, HomeAssistant, Member } from './types.ts'

const message = (e: unknown, fallback: string) => e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback

/** The Home Assistant section's body (Settings wraps it in its card). */
export function HomeAssistantSettings() {
  const { settings, reloadCore, toast } = useApp()
  const dialog = useDialog()
  const [ha, setHa] = useState<HomeAssistant | null>(null)
  const [zones, setZones] = useState<HaZone[] | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = () => { api.getHomeAssistant().then(setHa).catch(() => setHa(null)) }
  useEffect(load, [])
  useEffect(() => {
    if (ha?.connected) api.getHaZones().then(setZones).catch(() => setZones(null))
  }, [ha?.connected, ha?.url])
  if (!ha) return null

  const connectThis = async () => {
    setBusy(true)
    try { setHa(await api.connectHomeAssistant({ supervisor: true })); toast('Connected to Home Assistant') }
    catch (e) { toast(message(e, "Couldn't connect to Home Assistant"), true) }
    finally { setBusy(false) }
  }
  const saveShown = async (ids: string[]) => {
    try { setHa(await api.setShownPlaces(ids)); setZones(z => z && z.map(x => ({ ...x, shown: ids.includes(x.id) }))) }
    catch (e) { toast(message(e, "Couldn't save the places"), true) }
  }
  const setWalls = async () => {
    try { await api.updateSettings({ whereaboutsOnWalls: !settings.whereaboutsOnWalls }); reloadCore() }
    catch (e) { toast(message(e, "Couldn't save that"), true) }
  }
  const more = async (action: string) => {
    if (action !== 'disconnect') return
    if (!await dialog.confirm({ title: 'Disconnect Home Assistant?', body: 'Kinwall forgets the token, who is linked to whom and which places are shown. Where everyone is stops showing.', confirmLabel: 'Disconnect', danger: true })) return
    try { setHa(await api.disconnectHomeAssistant()); toast('Home Assistant disconnected') }
    catch (e) { toast(message(e, "Couldn't disconnect"), true) }
  }
  const sheet = connecting && <ConnectSheet ha={ha} onClose={() => setConnecting(false)} onConnected={next => { setHa(next); setConnecting(false); toast('Connected to Home Assistant') }} />

  if (!ha.connected) return <>
    <p className="settings-row-sub">Show where everyone is (Home, a place you choose, or Out) from your Home Assistant. Kinwall reads only place names, never a position on a map, and keeps nothing.</p>
    <div className="settings-inline-btns">
      {ha.supervisor && <button className="btn btn-primary" disabled={busy} onClick={connectThis}>Use this Home Assistant</button>}
      <button className={`btn ${ha.supervisor ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setConnecting(true)}>Connect Home Assistant</button>
    </div>
    {sheet}
  </>

  return <>
    <div className="chip-row ha-chips">
      <span className="chip chip-static"><span aria-hidden="true">🏡 </span>{ha.url}</span>
    </div>
    {ha.problem === 'reconnect' && (
      <div className="settings-row" role="alert">
        <div className="settings-row-sub">Can't reach Home Assistant. Reconnect to show where everyone is again.</div>
        <button className="btn btn-secondary" style={{ flex: 'none' }} onClick={() => ha.via === 'supervisor' ? connectThis() : setConnecting(true)}>Reconnect</button>
      </div>
    )}
    <div className="field">
      <label>Places shown by name</label>
      {zones
        ? <PickField label="Places shown by name" title="Places shown by name" multiple none="Home only" value={ha.shownPlaces}
            options={zones.map(z => ({ value: z.id, label: z.name }))} onChange={saveShown} />
        : <div className="settings-row-sub">Can't list Home Assistant's places right now.</div>}
      <p className="field-hint">Home always shows. Anywhere else reads “Out”. New places in Home Assistant stay hidden until you add them here.</p>
    </div>
    <p className="field-hint">Link each person to their Home Assistant person in their own settings above.</p>
    <div className="toggle-row">
      <div>
        <label id="ha-walls-label">Show where everyone is on wall screens</label>
        <div className="settings-row-sub" id="ha-walls-sub">Off: wall screens show nothing about where anyone is. Phones and tablets that belong to the family always do.</div>
      </div>
      <button className={`switch ${settings.whereaboutsOnWalls ? 'on' : ''}`} role="switch" aria-checked={!!settings.whereaboutsOnWalls} aria-labelledby="ha-walls-label" aria-describedby="ha-walls-sub" onClick={setWalls}><span className="knob" /></button>
    </div>
    <div className="settings-row">
      <button className="btn btn-secondary" style={{ flex: 'none' }} onClick={() => setConnecting(true)}>Change address or token</button>
      <select className="settings-select" aria-label="More Home Assistant actions" value="" onChange={e => more(e.target.value)}>
        <option value="">More…</option>
        <option value="disconnect">Disconnect Home Assistant</option>
      </select>
    </div>
    {sheet}
  </>
}

function ConnectSheet({ ha, onClose, onConnected }: { ha: HomeAssistant; onClose: () => void; onConnected: (ha: HomeAssistant) => void }) {
  const [url, setUrl] = useState(ha.via === 'token' ? ha.url ?? '' : '')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    setBusy(true); setError('')
    try { onConnected(await api.connectHomeAssistant({ url: url.trim(), token: token.trim() })) }
    catch (e) { setError(message(e, "Couldn't connect. Check the address and the token.")) }
    finally { setBusy(false) }
  }
  return (
    <Sheet title="Connect Home Assistant" onClose={onClose} actions={<button className="btn btn-primary" disabled={busy || !url.trim() || !token.trim()} onClick={connect}>Connect</button>}>
      <div className="field">
        <label htmlFor="ha-url">Home Assistant address</label>
        <input id="ha-url" type="url" inputMode="url" autoComplete="off" placeholder={ha.privateUrls ? 'http://homeassistant.local:8123' : 'https://example.ui.nabu.casa'} value={url} onChange={e => setUrl(e.target.value)} />
        <p className="field-hint">{ha.privateUrls
          ? 'The address you open Home Assistant at, at home or online.'
          : 'A public https address, like one from Nabu Casa. Home-network addresses only work when you host Kinwall yourself.'}</p>
      </div>
      <div className="field">
        <label htmlFor="ha-token">Long-lived access token</label>
        <input id="ha-token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
        <p className="field-hint">In Home Assistant, open your profile, then Security, and create a long-lived access token. Kinwall keeps it encrypted and never shows it again.</p>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </Sheet>
  )
}

/** A member's "Home Assistant person" row (their edit sheet, grown-ups' devices); hidden until Home Assistant is connected. */
export function HaPersonField({ member }: { member: Member }) {
  const { members, toast } = useApp()
  const [people, setPeople] = useState<HaPerson[] | null>(null)
  const load = () => {
    api.getHomeAssistant()
      .then(ha => ha.connected ? api.getHaPeople().then(setPeople) : setPeople(null))
      .catch(() => setPeople(null))
  }
  useEffect(load, [])
  if (!people) return null
  const mine = people.find(p => p.memberId === member.id)
  const nameOf = (id: string | null) => members.find(m => m.id === id)?.name
  const change = async ([id]: string[]) => {
    try {
      if (!id) await api.unlinkHaPerson(member.id)
      else await api.linkHaPerson(member.id, id)
      load()
      toast(id ? `Linked: ${member.name}` : `Unlinked: ${member.name}`)
    } catch (e) { toast(message(e, "Couldn't change that"), true) }
  }
  return (
    <div className="field">
      <label>Home Assistant person</label>
      <PickField label="Home Assistant person" value={[mine?.id ?? '']} none="Not linked" onChange={change} options={[
        { value: '', label: 'Not linked', detail: `Kinwall won't show where ${member.name} is` },
        ...people.map(p => ({ value: p.id, label: p.name, detail: p.memberId && p.memberId !== member.id ? `Linked to ${nameOf(p.memberId) ?? 'someone else'}` : undefined })),
      ]} />
      <p className="field-hint">Where everyone is shows {member.name}'s place from this Home Assistant person: Home, a place you chose, or Out.</p>
    </div>
  )
}
