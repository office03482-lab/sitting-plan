import { useParams } from 'react-router-dom';

import OnlineTestEditor from '@pages/OnlineTestEditor';

export default function OnlineTestEdit() {
  const { id = '' } = useParams();
  return <OnlineTestEditor mode="edit" testId={id} />;
}
