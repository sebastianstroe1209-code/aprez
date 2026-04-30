'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { apiGet, apiPut, apiPost } from '../../../../lib/api'

const CUISINE_TYPES = [
  'Romanian',
  'Italian',
  'Asian',
  'French',
  'Mediterranean',
  'Japanese',
  'Chinese',
  'Indian',
  'Mexican',
  'American',
  'Greek',
  'Turkish',
  'Seafood',
  'Steakhouse',
  'Vegetarian',
  'Vegan',
  'Pizza',
  'Fast Food',
  'Cafe',
  'Bar',
  'Fine Dining',
  'Traditional',
]

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAY_ABBREV = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function EditRestaurantPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [credentials, setCredentials] = useState(null)
  const [restaurant, setRestaurant] = useState(null)

  const [form, setForm] = useState({
    nameRo: '',
    nameEn: '',
    descriptionRo: '',
    descriptionEn: '',
    cuisineTypes: [],
    address: '',
    phone: '',
    email: '',
    website: '',
    openingHours: [],
    servicePeriods: [],
    maxPartySize: 30,
    autoConfirmEnabled: true,
    isActive: true,
  })

  useEffect(() => {
    fetchRestaurant()
  }, [id])

  const fetchRestaurant = async () => {
    try {
      setLoading(true)
      const data = await apiGet(`/api/admin/restaurants/${id}`)
      setRestaurant(data)
      setForm({
        nameRo: data.nameRo || '',
        nameEn: data.nameEn || '',
        descriptionRo: data.descriptionRo || '',
        descriptionEn: data.descriptionEn || '',
        cuisineTypes: data.cuisineTypes || [],
        address: data.address || '',
        phone: data.phone || '',
        email: data.email || '',
        website: data.website || '',
        openingHours: data.openingHours && data.openingHours.length > 0
          ? DAYS.map((day, idx) => {
              const existing = data.openingHours.find(oh => oh.dayOfWeek === idx)
              return {
                day,
                isOpen: existing ? existing.isOpen : true,
                openTime: existing?.openTime || '09:00',
                closeTime: existing?.closeTime || '23:00',
              }
            })
          : DAYS.map((day) => ({
              day,
              isOpen: true,
              openTime: '09:00',
              closeTime: '23:00',
            })),
        servicePeriods: data.servicePeriods && data.servicePeriods.length > 0
          ? data.servicePeriods.map(sp => ({
              nameRo: sp.nameRo || '',
              nameEn: sp.nameEn || '',
              startTime: sp.startTime || '12:00',
              endTime: sp.endTime || '15:00',
              daysOfWeek: sp.daysOfWeek || [0, 1, 2, 3, 4, 5, 6],
            }))
          : [{ nameRo: '', nameEn: '', startTime: '12:00', endTime: '15:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }],
        maxPartySize: data.maxPartySize || 30,
        autoConfirmEnabled: data.autoConfirmEnabled ?? true,
        isActive: data.isActive ?? true,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFormChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleCuisineChange = (cuisine) => {
    setForm((prev) => ({
      ...prev,
      cuisineTypes: prev.cuisineTypes.includes(cuisine)
        ? prev.cuisineTypes.filter((c) => c !== cuisine)
        : [...prev.cuisineTypes, cuisine],
    }))
  }

  const handleOpeningHourChange = (day, field, value) => {
    setForm((prev) => ({
      ...prev,
      openingHours: prev.openingHours.map((oh) =>
        oh.day === day ? { ...oh, [field]: value } : oh
      ),
    }))
  }

  const handleServicePeriodChange = (idx, field, value) => {
    setForm((prev) => ({
      ...prev,
      servicePeriods: prev.servicePeriods.map((sp, i) =>
        i === idx ? { ...sp, [field]: value } : sp
      ),
    }))
  }

  const addServicePeriod = () => {
    setForm((prev) => ({
      ...prev,
      servicePeriods: [
        ...prev.servicePeriods,
        { nameRo: '', nameEn: '', startTime: '12:00', endTime: '15:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      ],
    }))
  }

  const removeServicePeriod = (idx) => {
    setForm((prev) => ({
      ...prev,
      servicePeriods: prev.servicePeriods.filter((_, i) => i !== idx),
    }))
  }

  const toggleServicePeriodDay = (idx, dayIndex) => {
    setForm((prev) => ({
      ...prev,
      servicePeriods: prev.servicePeriods.map((sp, i) => {
        if (i !== idx) return sp
        const days = sp.daysOfWeek || [0, 1, 2, 3, 4, 5, 6]
        return {
          ...sp,
          daysOfWeek: days.includes(dayIndex)
            ? days.filter((d) => d !== dayIndex)
            : [...days, dayIndex].sort(),
        }
      }),
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      await apiPut(`/api/admin/restaurants/${id}`, form)
      fetchRestaurant()
      alert('Restaurant updated successfully!')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const generateNewCredentials = async () => {
    try {
      setSubmitting(true)
      const response = await apiPost(`/api/admin/restaurants/${id}/credentials`, {})
      setCredentials(response.credentials || response)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const toggleStatus = async () => {
    try {
      const action = form.isActive ? 'deactivate' : 'activate'
      await apiPut(`/api/admin/restaurants/${id}/${action}`, {})
      handleFormChange('isActive', !form.isActive)
      alert(`Restaurant ${!form.isActive ? 'activated' : 'deactivated'} successfully!`)
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  if (credentials) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <div className="text-5xl mb-4">✓</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-4">New Credentials Generated!</h2>
          <p className="text-gray-600 mb-6">Share these with {form.nameEn || form.nameRo}:</p>

          <div className="bg-gray-50 rounded p-4 mb-6 text-left">
            <p className="text-sm text-gray-600 mb-1">Username:</p>
            <p className="font-mono text-lg text-gray-800 mb-4 break-all">
              {credentials.username}
            </p>

            <p className="text-sm text-gray-600 mb-1">Password:</p>
            <p className="font-mono text-lg text-gray-800 break-all">
              {credentials.password}
            </p>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `Username: ${credentials.username}\nPassword: ${credentials.password}`
                )
              }}
              className="w-full bg-primary text-white px-4 py-2 rounded hover:bg-primary-dark transition-colors"
            >
              Copy Credentials
            </button>
            <button
              onClick={() => setCredentials(null)}
              className="w-full bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            {restaurant?.nameEn || restaurant?.nameRo}
          </h1>
          <p className="text-gray-600 mt-1">Edit restaurant details</p>
        </div>
        <div className="space-y-2">
          <button
            onClick={() => router.push(`/dashboard/restaurants/${id}/layout-editor`)}
            className="block w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            Edit Layout
          </button>
          <button
            onClick={generateNewCredentials}
            disabled={submitting}
            className="block w-full bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 disabled:bg-gray-400 transition-colors"
          >
            Generate New Credentials
          </button>
          <button
            onClick={toggleStatus}
            className={`block w-full text-white px-4 py-2 rounded transition-colors ${
              form.isActive
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {form.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          Error: {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-8 space-y-6">
        {/* Basic Info */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Basic Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Name (RO)</label>
              <input
                type="text"
                value={form.nameRo}
                onChange={(e) => handleFormChange('nameRo', e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Name (EN)</label>
              <input
                type="text"
                value={form.nameEn}
                onChange={(e) => handleFormChange('nameEn', e.target.value)}
                className="w-full"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description (RO)
              </label>
              <textarea
                value={form.descriptionRo}
                onChange={(e) => handleFormChange('descriptionRo', e.target.value)}
                className="w-full"
                rows="3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description (EN)
              </label>
              <textarea
                value={form.descriptionEn}
                onChange={(e) => handleFormChange('descriptionEn', e.target.value)}
                className="w-full"
                rows="3"
              />
            </div>
          </div>
        </div>

        {/* Contact */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Contact Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => handleFormChange('address', e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => handleFormChange('phone', e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleFormChange('email', e.target.value)}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Website</label>
              <input
                type="text"
                value={form.website}
                onChange={(e) => handleFormChange('website', e.target.value)}
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* Cuisine Types */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Cuisine Types</h2>
          <div className="grid grid-cols-3 gap-3">
            {CUISINE_TYPES.map((cuisine) => (
              <label key={cuisine} className="flex items-center">
                <input
                  type="checkbox"
                  checked={form.cuisineTypes.includes(cuisine)}
                  onChange={() => handleCuisineChange(cuisine)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">{cuisine}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Opening Hours */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Opening Hours</h2>
          <div className="space-y-3">
            {form.openingHours.map((oh) => (
              <div key={oh.day} className="flex items-center gap-4">
                <div className="w-24 text-sm font-medium text-gray-700">{oh.day}</div>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={oh.isOpen}
                    onChange={(e) => handleOpeningHourChange(oh.day, 'isOpen', e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm">Open</span>
                </label>
                {oh.isOpen && (
                  <>
                    <input
                      type="time"
                      value={oh.openTime}
                      onChange={(e) => handleOpeningHourChange(oh.day, 'openTime', e.target.value)}
                      className="w-32"
                    />
                    <span className="text-gray-400">to</span>
                    <input
                      type="time"
                      value={oh.closeTime}
                      onChange={(e) =>
                        handleOpeningHourChange(oh.day, 'closeTime', e.target.value)
                      }
                      className="w-32"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Service Periods */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Service Periods</h2>
          <div className="space-y-4">
            {form.servicePeriods.map((sp, idx) => (
              <div key={idx} className="p-4 border border-gray-300 rounded-lg">
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name (RO)
                    </label>
                    <input
                      type="text"
                      value={sp.nameRo}
                      onChange={(e) => handleServicePeriodChange(idx, 'nameRo', e.target.value)}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name (EN)
                    </label>
                    <input
                      type="text"
                      value={sp.nameEn}
                      onChange={(e) => handleServicePeriodChange(idx, 'nameEn', e.target.value)}
                      className="w-full"
                    />
                  </div>
                </div>
                <div className="flex gap-4 items-end mb-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={sp.startTime}
                      onChange={(e) => handleServicePeriodChange(idx, 'startTime', e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={sp.endTime}
                      onChange={(e) => handleServicePeriodChange(idx, 'endTime', e.target.value)}
                      className="w-32"
                    />
                  </div>
                  {form.servicePeriods.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeServicePeriod(idx)}
                      className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Active Days</label>
                  <div className="flex gap-2">
                    {DAY_ABBREV.map((dayLabel, dayIdx) => (
                      <button
                        key={dayIdx}
                        type="button"
                        onClick={() => toggleServicePeriodDay(idx, dayIdx)}
                        className={`w-10 h-10 rounded-full text-xs font-medium border-2 transition-colors ${
                          (sp.daysOfWeek || [0,1,2,3,4,5,6]).includes(dayIdx)
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {dayLabel}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addServicePeriod}
            className="mt-4 text-primary font-medium hover:underline"
          >
            + Add Service Period
          </button>
        </div>

        {/* Settings */}
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Party Size</label>
              <input
                type="number"
                value={form.maxPartySize}
                onChange={(e) => handleFormChange('maxPartySize', parseInt(e.target.value))}
                min="1"
                className="w-32"
              />
            </div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={form.autoConfirmEnabled}
                onChange={(e) => handleFormChange('autoConfirmEnabled', e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm text-gray-700">Auto-confirm reservations</span>
            </label>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-4 pt-6">
          <button
            type="submit"
            disabled={submitting}
            className="bg-primary text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-dark disabled:bg-gray-400 transition-colors"
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="bg-gray-300 text-gray-800 px-6 py-2 rounded-lg font-medium hover:bg-gray-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
