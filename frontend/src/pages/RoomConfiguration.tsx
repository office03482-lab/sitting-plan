import { useEffect, useState } from 'react';
import { Plus, Trash2, Edit2, Save, X } from 'lucide-react';
import { useAppStore } from '@store/app';
import {
  apiService,
  getMigrationUnavailableMessage,
  isMigrationGuardError,
  logIfUnexpectedRequestError,
} from '@services/api';
import { MigrationUnavailableNotice } from '@components/MigrationUnavailableNotice';
import type { Room } from '@types';

interface FormData {
  name: string;
  length_feet: number;
  width_feet: number;
  desk_length_feet: number;
  desk_width_feet: number;
  num_benches: number;
  teaching_zone_clearance_feet: number;
  aisle_width_feet: number;
  door_location: 'left' | 'right' | 'top' | 'bottom' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  window_location: string;
  glare_mitigation: boolean;
  is_accessible: boolean;
}

const DOOR_LOCATION_NORMALIZATION: Record<string, FormData['door_location']> = {
  front: 'top',
  back: 'bottom',
  left: 'left',
  right: 'right',
  top: 'top',
  bottom: 'bottom',
  'front_left': 'top_left',
  'left_front': 'top_left',
  top_left: 'top_left',
  'front_right': 'top_right',
  'right_front': 'top_right',
  top_right: 'top_right',
  'back_left': 'bottom_left',
  'left_back': 'bottom_left',
  bottom_left: 'bottom_left',
  'back_right': 'bottom_right',
  'right_back': 'bottom_right',
  bottom_right: 'bottom_right',
};

const normalizeDoorLocation = (value: string): FormData['door_location'] => {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return DOOR_LOCATION_NORMALIZATION[normalized] ?? 'left';
};

export default function RoomConfiguration() {
  const { rooms, setRooms } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [migrationUnavailable, setMigrationUnavailable] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    length_feet: 30,
    width_feet: 25,
    desk_length_feet: 2,
    desk_width_feet: 1.5,
    num_benches: 30,
    teaching_zone_clearance_feet: 5,
    aisle_width_feet: 3,
    door_location: 'left',
    window_location: 'SIDE',
    glare_mitigation: false,
    is_accessible: false,
  });

  useEffect(() => {
    loadRooms();
  }, []);

  const loadRooms = async () => {
    setLoading(true);
    try {
      const response = await apiService.listRooms();
      console.log('[RoomConfiguration]', 'API_ROWS', response.data?.length, response.data);
      setRooms(response.data);
      setMigrationUnavailable(false);
    } catch (error) {
      logIfUnexpectedRequestError('Failed to load rooms:', error);
      setMigrationUnavailable(isMigrationGuardError(error));
    } finally {
      setLoading(false);
    }
  };

  const calculateCapacity = (numBenches: number) => numBenches * 2;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : name.includes('feet') || name === 'num_benches'
          ? parseFloat(value) || 0
          : value,
    }));
  };

 const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!formData.name.trim()) {
    alert("Room name is required");
    return;
  }

  setLoading(true);

  try {
    const payload = { ...formData };

    if (editingId) {
      await apiService.updateRoom(editingId, payload);
    } else {
      await apiService.createRoom(payload);
    }

    await loadRooms();
    resetForm();
    setShowForm(false);
  } catch (error) {
    console.error("Failed to save room:", error);
    const errorMessage =
      (error as any)?.response?.data?.error ||
      (error as any)?.response?.data?.detail ||
      "Failed to save room";
    alert(errorMessage);
  } finally {
    setLoading(false);
  }
};

  const handleEdit = (room: Room) => {
    setEditingId(room.id);
    setFormData({
      name: room.name,
      length_feet: room.length_feet,
      width_feet: room.width_feet,
      desk_length_feet: room.desk_length_feet,
      desk_width_feet: room.desk_width_feet,
      num_benches: room.num_benches,
      teaching_zone_clearance_feet: room.teaching_zone_clearance_feet,
      aisle_width_feet: room.aisle_width_feet,
      door_location: normalizeDoorLocation(room.door_location),
      window_location: room.window_location || '',
      glare_mitigation: room.glare_mitigation,
      is_accessible: room.is_accessible,
    });
    setShowForm(true);
  };

  const handleDeleteAllRooms = async () => {
    if (confirm('Are you sure you want to delete all records? This action cannot be undone.')) {
      try {
        await apiService.deleteAllRooms(true);
        await loadRooms();
      } catch (error) {
        console.error('Failed to delete all rooms:', error);
        alert('Failed to delete all rooms');
      }
    }
  };

  const handleDelete = async (roomId: string | number) => {
    if (confirm('Are you sure you want to delete this room?')) {
      try {
        await apiService.deleteRoom(roomId);
        await loadRooms();
      } catch (error) {
        console.error('Failed to delete room:', error);
        alert('Failed to delete room');
      }
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      name: '',
      length_feet: 30,
      width_feet: 25,
      desk_length_feet: 2,
      desk_width_feet: 1.5,
      num_benches: 30,
      teaching_zone_clearance_feet: 5,
      aisle_width_feet: 3,
      door_location: 'left',
      window_location: 'Side',
      glare_mitigation: false,
      is_accessible: false,
    });
  };

  const filteredRooms = rooms;
  const displayedRooms = filteredRooms;

  useEffect(() => {
    console.log('[RoomConfiguration]', 'SET_STATE_ROWS', rooms.length);
  }, [rooms]);

  useEffect(() => {
    console.log('[RoomConfiguration]', 'FILTERED_ROWS', filteredRooms.length);
  }, [filteredRooms]);

  console.log('[RoomConfiguration]', 'RENDER_ROWS', displayedRooms.length);

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Room Configuration</h1>
          <div className="flex space-x-2">
            <button
              onClick={handleDeleteAllRooms}
              disabled={migrationUnavailable}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition"
            >
              <Trash2 className="w-4 h-4" />
              Delete All
            </button>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                disabled={migrationUnavailable}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
              >
                <Plus className="w-4 h-4" />
                Add Room
              </button>
            )}
          </div>
        </div>

        {migrationUnavailable ? (
          <div className="mb-8">
            <MigrationUnavailableNotice message={getMigrationUnavailableMessage('Room configuration')} />
          </div>
        ) : null}

        {/* Form Section */}
        {showForm && !migrationUnavailable && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                {editingId ? 'Edit Room' : 'Create New Room'}
              </h2>
              <button
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Room Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Main Hall A"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Number of Benches
                  </label>
                  <input
                    type="number"
                    name="num_benches"
                    value={formData.num_benches}
                    onChange={handleInputChange}
                    min="1"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Capacity: {calculateCapacity(formData.num_benches)} students (2 per bench)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Length (feet)
                  </label>
                  <input
                    type="number"
                    name="length_feet"
                    value={formData.length_feet}
                    onChange={handleInputChange}
                    step="0.5"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Width (feet)
                  </label>
                  <input
                    type="number"
                    name="width_feet"
                    value={formData.width_feet}
                    onChange={handleInputChange}
                    step="0.5"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Desk Length (feet)
                  </label>
                  <input
                    type="number"
                    name="desk_length_feet"
                    value={formData.desk_length_feet}
                    onChange={handleInputChange}
                    step="0.5"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Desk Width (feet)
                  </label>
                  <input
                    type="number"
                    name="desk_width_feet"
                    value={formData.desk_width_feet}
                    onChange={handleInputChange}
                    step="0.5"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Teaching Zone Clearance (feet)
                  </label>
                  <input
                    type="number"
                    name="teaching_zone_clearance_feet"
                    value={formData.teaching_zone_clearance_feet}
                    onChange={handleInputChange}
                    step="0.5"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Aisle Width (feet)
                  </label>
                  <input
                    type="number"
                    name="aisle_width_feet"
                    value={formData.aisle_width_feet}
                    onChange={handleInputChange}
                    step="0.5"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Door Location
                  </label>
                  <select
                    name="door_location"
                    value={formData.door_location}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="top_left">Top Left</option>
                    <option value="top_right">Top Right</option>
                    <option value="bottom_left">Bottom Left</option>
                    <option value="bottom_right">Bottom Right</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Window Location
                  </label>
                  <input
                    type="text"
                    name="window_location"
                    value={formData.window_location}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Side, Front"
                  />
                </div>
              </div>

              <div className="flex gap-4 mt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="glare_mitigation"
                    checked={formData.glare_mitigation}
                    onChange={handleInputChange}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Enable Glare Mitigation
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    name="is_accessible"
                    checked={formData.is_accessible}
                    onChange={handleInputChange}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    Handicap Accessible
                  </span>
                </label>
              </div>

              <div className="flex gap-2 mt-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg transition"
                >
                  <Save className="w-4 h-4" />
                  {loading ? 'Saving...' : 'Save Room'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                  className="flex items-center gap-2 bg-gray-600 hover:bg-gray-700 text-white px-6 py-2 rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Rooms Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading && displayedRooms.length === 0 ? (
            <div className="col-span-3 text-center text-gray-600 py-8">Loading rooms...</div>
          ) : displayedRooms.length === 0 ? (
            <div className="col-span-3 text-center text-gray-600 py-8">
              {migrationUnavailable ? 'Room data temporarily unavailable.' : 'No rooms configured yet. Create the first one!'}
            </div>
          ) : (
            displayedRooms.map((room) => (
              <div key={room.id} className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">{room.name}</h3>

                <div className="space-y-2 text-sm text-gray-600 mb-4">
                  <p>
                    <span className="font-medium">Capacity:</span> {room.capacity} students
                  </p>
                  <p>
                    <span className="font-medium">Dimensions:</span> {room.length_feet}ft × {room.width_feet}ft
                  </p>
                  <p>
                    <span className="font-medium">Benches:</span> {room.num_benches}
                  </p>
                  <p>
                    <span className="font-medium">Door:</span> {room.door_location}
                  </p>
                  <div className="flex gap-2 mt-2">
                    {room.glare_mitigation && (
                      <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-medium">
                        Glare Control
                      </span>
                    )}
                    {room.is_accessible && (
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">
                        Accessible
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(room)}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(room.id)}
                    className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
