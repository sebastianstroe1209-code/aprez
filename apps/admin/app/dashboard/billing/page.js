'use client'

import { useEffect, useState } from 'react'
import { apiGet, apiPost, apiPut } from '../../../lib/api'

export default function BillingPage() {
  const [billing, setBilling] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchBilling()
  }, [])

  const fetchBilling = async () => {
    try {
      setLoading(true)
      const data = await apiGet('/api/admin/billing')
      setBilling(data || [])
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleMarkAsPaid = async (billingId) => {
    try {
      setSubmitting(true)
      await apiPost(`/api/admin/billing/${billingId}/mark-paid`, {})
      fetchBilling()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleGenerateReports = async () => {
    try {
      setSubmitting(true)
      // Generate for current month
      const now = new Date()
      const month = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      await apiPost('/api/admin/billing/generate', { month })
      alert('Reports generated successfully!')
      fetchBilling()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Billing & Revenue</h1>
          <p className="text-gray-600 mt-1">Manage payments and generate reports</p>
        </div>
        <button
          onClick={handleGenerateReports}
          disabled={submitting}
          className="bg-accent text-white px-6 py-2 rounded-lg font-medium hover:bg-green-600 disabled:bg-gray-400 transition-colors"
        >
          Generate Reports
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          Error: {error}
        </div>
      )}

      {billing.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <p className="text-gray-600 text-lg">No billing records yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Restaurant
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Month</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Total Diners
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Amount (RON)
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {billing.map((record, idx) => (
                <tr
                  key={record.id}
                  className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-6 py-4 text-sm text-gray-800 font-medium">
                    {record.restaurant?.nameEn || record.restaurant?.nameRo || 'Unknown'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {new Date(record.month).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{record.totalDiners}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-gray-800">
                    {parseFloat(record.amountOwedRon || 0).toFixed(2)} RON
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        record.paymentStatus === 'PAID'
                          ? 'bg-green-100 text-green-800'
                          : record.paymentStatus === 'PENDING'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {record.paymentStatus.charAt(0) + record.paymentStatus.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {record.paymentStatus !== 'PAID' && (
                      <button
                        onClick={() => handleMarkAsPaid(record.id)}
                        disabled={submitting}
                        className="text-accent hover:underline font-medium disabled:text-gray-400"
                      >
                        Mark as Paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {billing.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Summary</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm text-gray-600 mb-1">Total Records</p>
              <p className="text-2xl font-bold text-gray-800">{billing.length}</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-gray-600 mb-1">Paid</p>
              <p className="text-2xl font-bold text-gray-800">
                {billing.filter((b) => b.paymentStatus === 'PAID').length}
              </p>
            </div>
            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
              <p className="text-sm text-gray-600 mb-1">Pending</p>
              <p className="text-2xl font-bold text-gray-800">
                {billing.filter((b) => b.paymentStatus === 'PENDING').length}
              </p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
              <p className="text-sm text-gray-600 mb-1">Total Revenue</p>
              <p className="text-2xl font-bold text-gray-800">
                {billing.reduce((sum, b) => sum + parseFloat(b.amountOwedRon || 0), 0).toFixed(2)} RON
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
