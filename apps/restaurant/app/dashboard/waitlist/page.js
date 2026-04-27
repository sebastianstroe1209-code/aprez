'use client'

import { useState, useEffect } from 'react'
import { apiGet, apiPost, apiDelete } from '../../../lib/api'

export default function WaitlistPage() {
  const [waitlist, setWaitlist] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadWaitlist()
  }, [])

  const loadWaitlist = async () => {
    try {
      setLoading(true)
      const [waitlistData, suggestionsData] = await Promise.all([
        apiGet('/api/restaurant/waitlist'),
        apiGet('/api/restaurant/waitlist/suggestions'),
      ])
      setWaitlist(waitlistData)
      setSuggestions(suggestionsData)
    } catch (err) {
      setError(err.message || 'Failed to load waitlist')
    } finally {
      setLoading(false)
    }
  }

  const handleNotify = async (id) => {
    try {
      await apiPost(`/api/restaurant/waitlist/${id}/notify`, {})
      loadWaitlist()
    } catch (err) {
      alert('Failed to notify: ' + err.message)
    }
  }

  const handleRemove = async (id) => {
    if (!confirm('Remove from waitlist?')) return
    try {
      await apiDelete(`/api/restaurant/waitlist/${id}`)
      loadWaitlist()
    } catch (err) {
      alert('Failed to remove: ' + err.message)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading waitlist...</div>
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Waitlist</h1>

      {error && (
        <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Smart Suggestions */}
      {suggestions.length > 0 && (
        <div className="mb-6 bg-blue-50 rounded-lg shadow p-6 border-l-4 border-blue-500">
          <h2 className="text-lg font-bold text-blue-900 mb-4">Smart Suggestions</h2>
          <p className="text-sm text-blue-800 mb-4">
            The following waitlisted guests can be seated at available tables:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {suggestions.map((suggestion) => (
              <div key={suggestion.waitlistEntryId} className="bg-white rounded p-4 border border-blue-200">
                <div className="font-medium text-blue-900">
                  Party of {suggestion.partySize}
                </div>
                <div className="text-sm text-gray-600 mt-2">
                  Can be seated at: Table {suggestion.suggestedTableNumber} ({suggestion.suggestedTableSeats} seats)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waitlist Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold">Position</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Guest Name</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Phone</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Party Size</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Time Added</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {waitlist.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
                    No guests on waitlist
                  </td>
                </tr>
              ) : (
                waitlist.map((entry) => (
                  <tr key={entry.id} className="border-b hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-bold text-accent">{entry.position}</td>
                    <td className="px-6 py-4 text-sm">
                      {entry.user ? `${entry.user.firstName} ${entry.user.lastName}` : 'N/A'}
                    </td>
                    <td className="px-6 py-4 text-sm">{entry.user?.phone || 'N/A'}</td>
                    <td className="px-6 py-4 text-sm">{entry.partySize}</td>
                    <td className="px-6 py-4 text-sm">
                      {new Date(entry.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        entry.status === 'WAITING' ? 'bg-yellow-100 text-yellow-800' :
                        entry.status === 'NOTIFIED' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleNotify(entry.id)}
                          className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                          disabled={entry.status === 'NOTIFIED'}
                        >
                          Notify
                        </button>
                        <button
                          onClick={() => handleRemove(entry.id)}
                          className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
