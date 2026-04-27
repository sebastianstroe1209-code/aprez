'use client'

import { useEffect, useState } from 'react'
import { apiGet, apiPost, apiDelete } from '../../../lib/api'

export default function TeamPage() {
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
  })

  useEffect(() => {
    fetchTeam()
  }, [])

  const fetchTeam = async () => {
    try {
      setLoading(true)
      const data = await apiGet('/api/admin/team')
      setTeam(data || [])
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.name || !form.password) {
      alert('Please fill in all fields')
      return
    }

    try {
      setSubmitting(true)
      await apiPost('/api/admin/team', form)
      fetchTeam()
      setForm({ email: '', name: '', password: '' })
      setShowForm(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (memberId) => {
    if (!confirm('Delete this team member?')) return

    try {
      await apiDelete(`/api/admin/team/${memberId}`)
      fetchTeam()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Team Management</h1>
          <p className="text-gray-600 mt-1">Manage admin users and permissions</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-accent text-white px-6 py-2 rounded-lg font-medium hover:bg-green-600 transition-colors"
        >
          + Add Member
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          Error: {error}
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Add Team Member</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="bg-accent text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-gray-400 transition-colors"
              >
                {submitting ? 'Adding...' : 'Add Member'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setForm({ email: '', name: '', password: '' })
                }}
                className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {team.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <p className="text-gray-600 text-lg">No team members yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Role</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {team.map((member, idx) => (
                <tr
                  key={member.id}
                  className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-6 py-4 text-sm text-gray-800 font-medium">{member.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{member.email}</td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {member.role || 'Admin'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <button
                      onClick={() => handleDelete(member.id)}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
