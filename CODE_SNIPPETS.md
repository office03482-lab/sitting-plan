# Key Code Snippets - Batch Selection & Invigilator Management

## 1. Batch Selection in SeatingGeneration.tsx

### State Management
```typescript
const [selectedBatch, setSelectedBatch] = useState<string>('');
const [batches, setBatches] = useState<any[]>([]);
```

### Load Batches on Mount
```typescript
const loadInitialData = async () => {
  setLoading(true);
  try {
    const [roomsRes, examsRes, batchesRes] = await Promise.all([
      apiService.listRooms(),
      apiService.listExams(),
      apiService.listBatches(1, true), // Load active batches only
    ]);
    setRooms(roomsRes.data);
    setExams(examsRes.data);
    setBatches(batchesRes.data || []);
  } catch (error) {
    console.error('Failed to load data:', error);
    setMessage('Failed to load rooms, exams, and batches');
  } finally {
    setLoading(false);
  }
};
```

### Batch Selection Validation
```typescript
const handleGeneratePlans = async () => {
  if (!selectedExam) {
    setMessage('Please select an exam');
    return;
  }

  if (!selectedBatch) {
    setMessage('Please select a batch before generating the seating plan');
    return;
  }

  if (selectedRooms.length === 0) {
    setMessage('Please select at least one room');
    return;
  }

  setLoading(true);
  setMessage('');

  try {
    const response = await apiService.generateSeatingPlans(
      selectedExam, 
      selectedRooms, 
      planType, 
      selectedBatch  // NEW: Pass batch parameter
    );
    
    const plansForBatch = response.data.plans || [];
    setGeneratedPlans(plansForBatch);
    setSeatingPlans(plansForBatch);
    setMessage(`Successfully generated ${plansForBatch.length} seating plans for batch: ${selectedBatch}`);
  } catch (error: any) {
    console.error('Failed to generate plans:', error);
    setMessage(error?.response?.data?.error || error?.response?.data?.detail || 'Failed to generate seating plans');
  } finally {
    setLoading(false);
  }
};
```

### Batch Dropdown JSX
```jsx
{/* Batch Selection */}
<div>
  <label className="block text-sm font-medium text-gray-700 mb-3">
    Select Batch <span className="text-red-600">*</span>
  </label>
  {batches.length === 0 ? (
    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
      No batches available. Please create batches in Batch Management.
    </div>
  ) : (
    <select
      value={selectedBatch}
      onChange={(e) => setSelectedBatch(e.target.value)}
      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
      required
    >
      <option value="">-- Choose Batch --</option>
      {batches.map((batch) => (
        <option key={batch.id || batch.name} value={batch.name || batch.id}>
          {batch.name || `Batch ${batch.id}`}
        </option>
      ))}
    </select>
  )}
  {selectedBatch && (
    <p className="text-xs text-green-600 mt-2">✓ Batch selected: {selectedBatch}</p>
  )}
</div>
```

### Generate Button with Batch Validation
```jsx
<button
  onClick={handleGeneratePlans}
  disabled={!selectedExam || !selectedBatch || selectedRooms.length === 0 || loading}
  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-8 py-3 rounded-lg transition font-semibold"
>
  <Zap className="w-5 h-5" />
  {loading ? 'Generating Plans...' : 'Generate Seating Plans'}
</button>
```

---

## 2. Backend Batch Filtering in seating.py

### Updated Schema
```python
class GenerateSeatingRequest(BaseModel):
    """Request to generate seating plans"""
    exam_id: int
    room_ids: List[int]
    batch: Optional[str] = None  # Filter students by batch (NEW)
    plan_type: Optional[str] = "both"
    algorithm_version: str = "1.0"
```

### Batch Filtering in Generate Endpoint
```python
@router.post("/generate")
async def generate_seating_plans(
    request: GenerateSeatingRequest,
    db: Session = Depends(get_db),
):
    """Generate both Plan A (strict) and Plan B (compact) seating plans"""
    
    # Get exam and students
    exam = db.query(Exam).filter(Exam.id == request.exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    
    # Get students, optionally filtered by batch (NEW)
    query = db.query(Student).filter(Student.is_active == True)
    
    if request.batch:
        query = query.filter(Student.batch == request.batch)
    
    students = query.limit(100).all()
    
    if not students:
        batch_info = f" for batch '{request.batch}'" if request.batch else ""
        raise HTTPException(status_code=400, detail=f"No students found{batch_info}")
    
    # Convert to dict for algorithm
    students_data = [
        {
            'id': s.id,
            'name': s.name,
            'roll_number': s.roll_number,
            'batch': s.batch,
            'email': s.email,
        }
        for s in students
    ]
    
    # ... rest of generation logic
```

### Plan Names with Batch Label
```python
batch_label = f" - Batch {request.batch}" if request.batch else ""

plan_a = SeatingPlan(
    exam_id=exam.id,
    room_id=room_id,
    name=f"{room.name} - Plan A (Strict){batch_label}",  # Includes batch
    plan_type="strict",
    students_assigned=len(students_data) - len(plan_a_result['unassigned']),
    is_valid=plan_a_result['validity'],
)

plan_b = SeatingPlan(
    exam_id=exam.id,
    room_id=room_id,
    name=f"{room.name} - Plan B (Compact){batch_label}",  # Includes batch
    plan_type="compact",
    students_assigned=len(students_data) - len(plan_b_result['unassigned']),
    is_valid=plan_b_result['validity'],
)
```

---

## 3. Invigilator API Service Methods in api.ts

### Create Invigilator
```typescript
async createInvigilator(invigilatorData: any, schoolId: number = 1) {
  return this.api.post<Invigilator>('/invigilators', invigilatorData, {
    params: { school_id: schoolId },
  });
}
```

### List Invigilators
```typescript
async listInvigilators(schoolId: number = 1, isActive?: boolean, skip = 0, limit = 100) {
  const params: any = { school_id: schoolId, skip, limit };
  if (isActive !== undefined) {
    params.is_active = isActive;
  }
  return this.api.get<Invigilator[]>('/invigilators', { params });
}
```

### Delete Invigilator
```typescript
async deleteInvigilator(invigilatorId: number) {
  return this.api.delete(`/invigilators/${invigilatorId}`);
}
```

### Assign Invigilator to Room
```typescript
async assignInvigilatorToRoom(assignment: any, schoolId: number = 1) {
  return this.api.post<RoomInvigilator>('/invigilators/room-assignment', assignment, {
    params: { school_id: schoolId },
  });
}
```

### List Room Assignments
```typescript
async listRoomAssignments(schoolId: number = 1, roomId?: number, invigilatorId?: number, isActive = true) {
  const params: any = { school_id: schoolId, is_active: isActive };
  if (roomId) params.room_id = roomId;
  if (invigilatorId) params.invigilator_id = invigilatorId;
  return this.api.get<RoomInvigilator[]>('/invigilators/assignments', { params });
}
```

### Update Room Assignment
```typescript
async updateRoomAssignment(assignmentId: number, data: Partial<RoomInvigilator>) {
  return this.api.put<RoomInvigilator>(`/invigilators/assignments/${assignmentId}`, data);
}
```

### Delete Room Assignment
```typescript
async deleteRoomAssignment(assignmentId: number) {
  return this.api.delete(`/invigilators/assignments/${assignmentId}`);
}
```

---

## 4. Invigilator Management Component - Add Invigilator

### Add Form Handler
```typescript
const handleAddInvigilator = async (e: React.FormEvent) => {
  e.preventDefault();
  try {
    await apiService.createInvigilator(formData, schoolId);
    setFormData({ staff_id: '', name: '', email: '', phone: '', designation: '', is_active: true });
    setShowAddForm(false);
    loadData();
    showMessage('Invigilator added successfully', 'success');
  } catch (error: any) {
    console.error('Error adding invigilator:', error);
    showMessage(error?.response?.data?.detail || 'Failed to add invigilator', 'error');
  }
};
```

### Add Form JSX
```jsx
{showAddForm && (
  <form onSubmit={handleAddInvigilator} className="mb-6 p-4 bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg border border-gray-200">
    <h3 className="font-semibold text-gray-900 mb-4">New Invigilator</h3>
    <div className="grid grid-cols-2 gap-4 mb-4">
      <input
        type="text"
        placeholder="Staff ID (e.g., S001)"
        value={formData.staff_id}
        onChange={(e) => setFormData({ ...formData, staff_id: e.target.value })}
        className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        required
      />
      <input
        type="text"
        placeholder="Full Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        required
      />
      <input
        type="email"
        placeholder="Email"
        value={formData.email}
        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
        className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      />
      <input
        type="tel"
        placeholder="Phone"
        value={formData.phone}
        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
        className="border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      />
      <input
        type="text"
        placeholder="Designation (e.g., Senior Teacher)"
        value={formData.designation}
        onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
        className="border border-gray-300 rounded-lg px-4 py-2 col-span-2 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      />
      <label className="col-span-2 flex items-center space-x-2 cursor-pointer">
        <input
          type="checkbox"
          checked={formData.is_active}
          onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
          className="w-4 h-4 rounded border-gray-300"
        />
        <span className="text-sm text-gray-700">Active Status</span>
      </label>
    </div>
    <div className="flex gap-3">
      <button
        type="submit"
        className="flex-1 bg-purple-600 text-white py-2 rounded-lg font-semibold hover:bg-purple-700 transition-all"
      >
        Add Invigilator
      </button>
      <button
        type="button"
        onClick={() => setShowAddForm(false)}
        className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-400 transition-all"
      >
        Cancel
      </button>
    </div>
  </form>
)}
```

---

## 5. Invigilator List Display

### Invigilator Card
```jsx
{invigilators.map((inv) => (
  <div key={inv.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-purple-50 transition-all">
    <div className="flex-1">
      <div className="flex items-center space-x-2">
        <p className="font-semibold text-gray-900">{inv.name}</p>
        {inv.is_active ? (
          <span className="inline-flex items-center space-x-1 bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
            <CheckCircle className="w-3 h-3" />
            <span>Active</span>
          </span>
        ) : (
          <span className="inline-flex items-center space-x-1 bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded-full">
            <AlertCircle className="w-3 h-3" />
            <span>Inactive</span>
          </span>
        )}
      </div>
      <p className="text-sm text-gray-600 mt-1">{inv.staff_id}</p>
      {inv.designation && <p className="text-xs text-gray-500">{inv.designation}</p>}
      <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
        {inv.email && (
          <span className="flex items-center space-x-1">
            <Mail className="w-3 h-3" />
            <span>{inv.email}</span>
          </span>
        )}
        {inv.phone && (
          <span className="flex items-center space-x-1">
            <Phone className="w-3 h-3" />
            <span>{inv.phone}</span>
          </span>
        )}
      </div>
    </div>
    <button
      onClick={() => handleDeleteInvigilator(inv.id)}
      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
      title="Delete Invigilator"
    >
      <Trash className="w-5 h-5" />
    </button>
  </div>
))}
```

---

## 6. Room Assignment Operations

### Assign Handler
```typescript
const handleAssignToRoom = async (e: React.FormEvent) => {
  e.preventDefault();
  try {
    await apiService.assignInvigilatorToRoom({
      room_id: parseInt(assignmentData.room_id),
      invigilator_id: parseInt(assignmentData.invigilator_id),
      notes: assignmentData.notes,
    }, schoolId);
    setAssignmentData({ room_id: '', invigilator_id: '', notes: '' });
    setShowAssignmentForm(false);
    loadData();
    showMessage('Invigilator assigned successfully', 'success');
  } catch (error: any) {
    console.error('Error assigning invigilator:', error);
    showMessage(error?.response?.data?.detail || 'Failed to assign invigilator', 'error');
  }
};
```

### Remove Assignment Handler
```typescript
const handleRemoveAssignment = async (assignmentId: number) => {
  if (window.confirm('Remove this invigilator from the room?')) {
    try {
      await apiService.deleteRoomAssignment(assignmentId);
      loadData();
      showMessage('Assignment removed successfully', 'success');
    } catch (error: any) {
      console.error('Error removing assignment:', error);
      showMessage(error?.response?.data?.detail || 'Failed to remove assignment', 'error');
    }
  }
};
```

### Assignment List Card
```jsx
{assignments.map((assign) => (
  <div key={assign.id} className="p-4 border border-gray-200 rounded-lg hover:bg-green-50 transition-all">
    <div className="flex justify-between items-start">
      <div>
        <p className="font-semibold text-sm text-gray-900">
          {assign.invigilator?.name || 'Unknown Invigilator'}
        </p>
        <p className="text-xs text-gray-600 mt-1">
          📍 {rooms.find((r) => r.id === assign.room_id)?.name || 'Unknown Room'}
        </p>
        {assign.notes && <p className="text-xs text-gray-500 mt-2 italic">"{assign.notes}"</p>}
      </div>
      <button
        onClick={() => handleRemoveAssignment(assign.id)}
        className="p-1 text-red-600 hover:bg-red-100 rounded transition-all"
        title="Remove Assignment"
      >
        <Trash className="w-4 h-4" />
      </button>
    </div>
  </div>
))}
```

---

## 7. Updated generateSeatingPlans API Method

```typescript
async generateSeatingPlans(examId: number, roomIds: number[], planType?: 'strict' | 'compact', batch?: string) {
  return this.api.post('/seating/generate', {
    exam_id: examId,
    room_ids: roomIds,
    batch: batch,  // NEW: Pass batch parameter
    plan_type: planType,
  });
}
```

---

## 8. TypeScript Interfaces for Invigilator

```typescript
export interface Invigilator {
  id: number;
  staff_id: string;
  name: string;
  school_id: number;
  email?: string;
  phone?: string;
  designation?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoomInvigilator {
  id: number;
  room_id: number;
  invigilator_id: number;
  school_id: number;
  exam_id?: number;
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  invigilator?: Invigilator;
  room?: Room;
}

export interface InvigilatorWithRooms extends Invigilator {
  room_assignments: RoomInvigilator[];
}
```

---

## 9. Message/Notification System

```typescript
const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
  setMessage(msg);
  setMessageType(type);
  setTimeout(() => setMessage(''), 3000);
};
```

### Message Display JSX
```jsx
{message && (
  <div className={`mb-6 p-4 rounded-lg flex items-center space-x-3 ${
    messageType === 'success' 
      ? 'bg-green-100 border border-green-300 text-green-800' 
      : 'bg-red-100 border border-red-300 text-red-800'
  }`}>
    {messageType === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
    <span>{message}</span>
  </div>
)}
```

---

## Summary of Key Changes

| Feature | Type | Location |
|---------|------|----------|
| Batch Selection | State + UI | SeatingGeneration.tsx |
| Batch Filtering | Backend | seating.py |
| Batch Validation | Frontend | SeatingGeneration.tsx |
| Invigilator CRUD | API Methods | api.ts |
| Invigilator UI | Component | InvigilatorManagement.tsx |
| Room Assignment | API + UI | InvigilatorManagement.tsx |
| Type Definitions | TypeScript | types/index.ts |
| Message System | Notification | InvigilatorManagement.tsx |

---

This reference file contains all the essential code snippets needed to understand the implementation!
