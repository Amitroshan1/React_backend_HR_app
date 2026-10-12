import { useNavigate } from 'react-router-dom';
import AddDeptCircle from '../HR/AddDeptCircle';

export default function AdminDepartments() {
  const navigate = useNavigate();

  return (
    <AddDeptCircle
      onBack={() => navigate('/admin/requests')}
      backLabel="Back to Request & Approval"
    />
  );
}
