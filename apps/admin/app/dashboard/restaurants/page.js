'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiGet, apiPut } from '../../../lib/api'

export default function RestaurantsPage() {
  const [restaurants, setRestaurants] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchRestaurants()
  }, [])

  const fetchRestaurants = async () => {
    try {
      setLoading(true)
      const data = await apiGet('/api/admin/restaurants')
      setRestaurants(data || [])
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleStatus = async (id, currentStatus) => {
    try {
      const action = currentStatus ? 'deactivate' : 'activate'
      await apiPut(`/api/admin/restaurants/${id}/${action}`, {})
      fetchRestaurants()
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
          <h1 className="text-3xl font-bold text-gray-800">Restaurants</h1>
          <p className="text-gray-600 mt-1">Manage restaurant profiles and settings</p>
        </div>
        <Link
          href="/dashboard/restaurants/new"
          className="bg-primary text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-dark transition-colors"
        >
          + Create Restaurant
        </Link>
      </div>

      {error && (
        <div className="p-4 bg-alert-error-bg border border-alert-error-border text-alert-error-fg rounded">
          Error: {error}
        </div>
      )}

      {restaurants.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <p className="text-gray-600 text-lg">No restaurants yet</p>
          <Link
            href="/dashboard/restaurants/new"
            className="mt-4 inline-block text-primary font-medium hover:underline"
          >
            Create the first one
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Cuisine</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Address</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {restaurants.map((restaurant, idx) => (
                <tr
                  key={restaurant.id}
                  className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                >
                  <td className="px-6 py-4 text-sm text-gray-800 font-medium">
                    {restaurant.nameEn || restaurant.nameRo}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {restaurant.cuisineTypes?.join(', ') || 'N/A'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{restaurant.address}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-medium ${
                        restaurant.isActive
                          ? 'bg-status-confirmed-bg text-status-confirmed-fg'
                          : 'bg-status-cancelled-bg text-status-cancelled-fg'
                      }`}
                    >
                      {restaurant.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm space-x-2">
                    <Link
                      href={`/dashboard/restaurants/${restaurant.id}`}
                      className="text-primary hover:underline font-medium"
                    >
                      Edit
                    </Link>
                    <Link
                      href={`/dashboard/restaurants/${restaurant.id}/layout-editor`}
                      className="text-primary hover:underline font-medium"
                    >
                      Layout
                    </Link>
                    <button
                      onClick={() => handleToggleStatus(restaurant.id, restaurant.isActive)}
                      className={`font-medium ${
                        restaurant.isActive
                          ? 'text-red-600 hover:underline'
                          : 'text-green-600 hover:underline'
                      }`}
                    >
                      {restaurant.isActive ? 'Deactivate' : 'Activate'}
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
