# Student/Parent Portal — Runtime Test Scenarios

## Test Scenarios

| # | Scenario | Intent | Expected Result |
|---|---|---|---|
| 1 | Valid active student logs in | `student_portal` | → Student Dashboard |
| 2 | Auth user with no student record | `student_portal` | 403 Forbidden, redirect to login |
| 3 | Student with `is_active=false` | `student_portal` | 403 Forbidden, redirect to login |
| 4 | Valid active guardian with ≥1 student logs in | `parent_portal` | → Parent Dashboard |
| 5 | Guardian with zero linked students | `parent_portal` | 403 Forbidden, redirect to login |
| 6 | Parent with multiple linked students | `parent_portal` | Dashboard shows only linked students |
| 7 | Student attempts parent intent | `parent_portal` | 403 (no guardian record) |
| 8 | Parent attempts student intent | `student_portal` | 403 (no student record) |
| 9 | Parent attempts School ERP intent | `school_erp` | 403 unless has membership |
| 10 | Student attempts School ERP intent | `school_erp` | 403 unless has membership |
| 11 | Platform admin attempts student portal | `student_portal` | 403 unless also has student record |
| 12 | Portal switch (ERP → Student) | Clear intent | New bootstrap, fresh state |

## How to Run

```bash
# Test case 1-3
npm run dev  # navigate to /login?intent=student_portal

# Test case 4-6
npm run dev  # navigate to /login?intent=parent_portal

# Test case 7-12
# Use browser dev tools to modify intent cookie manually
```
