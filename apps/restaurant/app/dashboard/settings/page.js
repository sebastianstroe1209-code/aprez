'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { apiGet, apiPut, apiPost, apiDelete } from '../../../lib/api'
import { formatDate } from '../../../lib/format'
import { useAppLocale } from '../../../lib/i18n/I18nProvider'
import { isAudioEnabled, setAudioEnabled } from '../../../lib/audio'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_ABBREV = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function SettingsPage() {
  const t = useTranslations()
  const { locale, setLocale } = useAppLocale()
  // Audio-alert toggle state. Hydrate from localStorage after mount so
  // SSR doesn't see "window is not defined".
  const [audioOn, setAudioOnState] = useState(true)
  useEffect(() => { setAudioOnState(isAudioEnabled()) }, [])
  const handleAudioToggle = (next) => {
    setAudioOnState(next)
    setAudioEnabled(next)
  }
  const [profile, setProfile] = useState({
    nameEn: '',
    nameRo: '',
    descriptionRo: '',
    descriptionEn: '',
    phone: '',
    email: '',
    website: '',
  })
  const [openingHours, setOpeningHours] = useState([])
  const [servicePeriods, setServicePeriods] = useState([])
  const [autoConfirmEnabled, setAutoConfirmEnabled] = useState(false)
  const [bans, setBans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showBanModal, setShowBanModal] = useState(false)
  const [banForm, setBanForm] = useState({
    phone: '',
    email: '',
  })

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const [profileData, bansData] = await Promise.all([
        apiGet('/api/restaurant/profile'),
        apiGet('/api/restaurant/bans'),
      ])
      setProfile(profileData)
      setOpeningHours(profileData.openingHours || [])
      setServicePeriods(profileData.servicePeriods || [])
      setAutoConfirmEnabled(profileData.autoConfirmEnabled || false)
      setBans(bansData)
    } catch (err) {
      setError(err.message || 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const handleProfileChange = (e) => {
    const { name, value } = e.target
    setProfile({ ...profile, [name]: value })
  }

  const handleSaveProfile = async () => {
    try {
      setError('')
      setSuccess('')
      await apiPut('/api/restaurant/profile', {
        descriptionRo: profile.descriptionRo,
        descriptionEn: profile.descriptionEn,
        phone: profile.phone,
        email: profile.email,
        website: profile.website,
      })
      setSuccess('Profile updated successfully')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.message || 'Failed to save profile')
    }
  }

  const handleToggleAutoConfirm = async () => {
    try {
      setError('')
      setSuccess('')
      await apiPut('/api/restaurant/settings', {
        autoConfirmEnabled: !autoConfirmEnabled,
      })
      setAutoConfirmEnabled(!autoConfirmEnabled)
      setSuccess('Settings updated successfully')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.message || 'Failed to update settings')
    }
  }

  const handleBanUser = async (e) => {
    e.preventDefault()
    if (!banForm.phone && !banForm.email) {
      alert('Please enter phone or email')
      return
    }
    try {
      setError('')
      await apiPost('/api/restaurant/bans', {
        phone: banForm.phone,
        email: banForm.email,
      })
      setShowBanModal(false)
      setBanForm({ phone: '', email: '' })
      loadSettings()
    } catch (err) {
      alert('Failed to ban user: ' + err.message)
    }
  }

  const handleUnban = async (banId) => {
    if (!confirm('Unban this user?')) return
    try {
      await apiDelete(`/api/restaurant/bans/${banId}`)
      loadSettings()
    } catch (err) {
      alert('Failed to unban: ' + err.message)
    }
  }

  if (loading) {
    return <div className="text-center py-12">{t('common.loading')}</div>
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">{t('settings.title')}</h1>

      {/* Language Toggle (C5 scaffold) */}
      <div className="mb-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-2">{t('settings.languageSectionTitle')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings.languageSectionHint')}</p>
        <div className="flex gap-2">
          {['ro', 'en'].map((code) => (
            <button
              key={code}
              onClick={() => setLocale(code)}
              className={`px-4 py-2 rounded font-medium transition-colors ${
                locale === code
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Audio alerts toggle (C6 P3-2 §3.6) */}
      <div className="mb-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-2">{t('settings.audio.title')}</h2>
        <p className="text-sm text-gray-500 mb-4">{t('settings.audio.description')}</p>
        <div className="flex gap-2">
          <button
            onClick={() => handleAudioToggle(true)}
            className={`px-4 py-2 rounded font-medium transition-colors min-h-[44px] ${
              audioOn ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t('settings.audio.toggleOn')}
          </button>
          <button
            onClick={() => handleAudioToggle(false)}
            className={`px-4 py-2 rounded font-medium transition-colors min-h-[44px] ${
              !audioOn ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t('settings.audio.toggleOff')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
          {success}
        </div>
      )}

      {/* Restaurant Profile */}
      <div className="mb-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-6">Restaurant Profile</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Restaurant Name</label>
            <input
              type="text"
              value={profile.nameEn || profile.nameRo || ''}
              disabled
              className="w-full bg-gray-100"
            />
            <p className="text-xs text-gray-500 mt-1">Read-only - managed by admin</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description (Romanian)</label>
            <textarea
              name="descriptionRo"
              value={profile.descriptionRo || ''}
              onChange={handleProfileChange}
              rows="4"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description (English)</label>
            <textarea
              name="descriptionEn"
              value={profile.descriptionEn || ''}
              onChange={handleProfileChange}
              rows="4"
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Phone</label>
              <input
                type="text"
                name="phone"
                value={profile.phone || ''}
                onChange={handleProfileChange}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <input
                type="email"
                name="email"
                value={profile.email || ''}
                onChange={handleProfileChange}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Website</label>
              <input
                type="text"
                name="website"
                value={profile.website || ''}
                onChange={handleProfileChange}
                className="w-full"
              />
            </div>
          </div>

          <button
            onClick={handleSaveProfile}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark transition-colors"
          >
            Save Profile
          </button>
        </div>
      </div>

      {/* Opening Hours (read-only) */}
      {openingHours.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold mb-6">Opening Hours</h2>
          <p className="text-xs text-gray-500 mb-4">Managed by admin</p>
          <div className="space-y-2">
            {openingHours.map((oh) => (
              <div key={oh.id} className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium text-gray-700">
                  {DAYS[oh.dayOfWeek] || `Day ${oh.dayOfWeek}`}
                </div>
                {oh.isOpen ? (
                  <span className="text-sm text-gray-600">{oh.openTime} — {oh.closeTime}</span>
                ) : (
                  <span className="text-sm text-red-500">Closed</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Service Periods (read-only) */}
      {servicePeriods.length > 0 && (
        <div className="mb-8 bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold mb-6">Service Periods</h2>
          <p className="text-xs text-gray-500 mb-4">Managed by admin</p>
          <div className="space-y-4">
            {servicePeriods.map((sp) => (
              <div key={sp.id} className="p-4 border border-gray-200 rounded-lg">
                <div className="flex justify-between items-start mb-2">
                  <div className="font-medium text-gray-800">{sp.nameEn || sp.nameRo}</div>
                  <div className="text-sm text-gray-600">{sp.startTime} — {sp.endTime}</div>
                </div>
                <div className="flex gap-2">
                  {DAY_ABBREV.map((dayLabel, dayIdx) => (
                    <span
                      key={dayIdx}
                      className={`w-9 h-9 rounded-full text-xs font-medium flex items-center justify-center ${
                        (sp.daysOfWeek || [0,1,2,3,4,5,6]).includes(dayIdx)
                          ? 'bg-primary text-white'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {dayLabel}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reservations Settings */}
      <div className="mb-8 bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-6">Reservation Settings</h2>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium mb-2">Auto-Confirm Reservations</h3>
            <p className="text-sm text-gray-600">Automatically confirm new reservations when they match available tables</p>
          </div>
          <button
            onClick={handleToggleAutoConfirm}
            className={`px-6 py-2 rounded font-medium transition-colors ${
              autoConfirmEnabled
                ? 'bg-primary text-white hover:bg-primary-dark'
                : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
          >
            {autoConfirmEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* Ban Management */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Banned Users</h2>
          <button
            onClick={() => setShowBanModal(true)}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Ban User
          </button>
        </div>

        {bans.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            No banned users
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Name</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Phone</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Email</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Banned At</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bans.map((ban) => (
                  <tr key={ban.id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm">{ban.user ? `${ban.user.firstName} ${ban.user.lastName}` : 'N/A'}</td>
                    <td className="px-6 py-4 text-sm">{ban.user?.phone || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm">{ban.user?.email || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm">{formatDate(ban.createdAt)}</td>
                    <td className="px-6 py-4 text-sm">
                      <button
                        onClick={() => handleUnban(ban.id)}
                        className="text-xs px-3 py-1 bg-primary text-white rounded hover:bg-primary-dark"
                      >
                        Unban
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ban Modal */}
      {showBanModal && (
        <div className="modal-overlay" onClick={() => setShowBanModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">Ban User</h2>
              <form onSubmit={handleBanUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Phone (optional)</label>
                  <input
                    type="text"
                    value={banForm.phone}
                    onChange={(e) => setBanForm({ ...banForm, phone: e.target.value })}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Email (optional)</label>
                  <input
                    type="email"
                    value={banForm.email}
                    onChange={(e) => setBanForm({ ...banForm, email: e.target.value })}
                    className="w-full"
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    Ban User
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBanModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
