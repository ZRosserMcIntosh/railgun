import { useState } from 'react';
import { useVoipStore, CallRecord, CallDirection, CallStatus } from '../../stores/voipStore';

// ==================== Icons ====================

const PhoneOutgoingIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 3h5m0 0v5m0-5l-6 6M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.13a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
  </svg>
);

const PhoneIncomingIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 3l-6 6m0-6h6m-6 0v6M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.13a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
  </svg>
);

const PhoneMissedIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.13a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const ShieldIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
  </svg>
);

const PhoneIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
  </svg>
);

// ==================== Helper Functions ====================

const formatDuration = (seconds?: number): string => {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  
  if (isYesterday) {
    return 'Yesterday';
  }
  
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const getCallStatusColor = (status: CallStatus): string => {
  switch (status) {
    case CallStatus.ENDED:
      return 'text-green-500';
    case CallStatus.FAILED:
    case CallStatus.NO_ANSWER:
    case CallStatus.BUSY:
      return 'text-red-500';
    default:
      return 'text-text-muted';
  }
};

const getCallIcon = (record: CallRecord) => {
  if (record.status === CallStatus.FAILED || record.status === CallStatus.NO_ANSWER) {
    return <PhoneMissedIcon />;
  }
  return record.direction === CallDirection.OUTBOUND ? <PhoneOutgoingIcon /> : <PhoneIncomingIcon />;
};

// ==================== CallHistoryItem Component ====================

interface CallHistoryItemProps {
  record: CallRecord;
  onDelete: (id: string) => void;
  onCall: (number: string) => void;
}

const CallHistoryItem = ({ record, onDelete, onCall }: CallHistoryItemProps) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDelete = () => {
    onDelete(record.id);
    setShowConfirm(false);
  };

  return (
    <div className="group flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors border-b border-dark-800 last:border-b-0">
      {/* Call Direction Icon */}
      <div className={`${getCallStatusColor(record.status)}`}>
        {getCallIcon(record)}
      </div>

      {/* Call Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-text-primary font-medium truncate">
            {record.displayNumber}
          </span>
          {record.anonymous && (
            <span className="text-green-500" title="Anonymous call (*67)">
              <ShieldIcon />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span>{formatTime(record.startTime)}</span>
          {record.duration !== undefined && (
            <>
              <span>•</span>
              <span>{formatDuration(record.duration)}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Call Back Button */}
        <button
          onClick={() => onCall(record.phoneNumber)}
          className="p-2 text-green-500 hover:bg-green-900/30 rounded-full transition-colors"
          title="Call back"
          aria-label={`Call ${record.displayNumber}`}
        >
          <PhoneIcon />
        </button>

        {/* Delete Button */}
        {showConfirm ? (
          <div className="flex items-center gap-1">
            <button
              onClick={handleDelete}
              className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="px-2 py-1 text-xs bg-dark-600 text-text-secondary rounded hover:bg-dark-500 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            className="p-2 text-text-muted hover:text-red-500 hover:bg-red-900/30 rounded-full transition-colors"
            title="Delete permanently"
            aria-label="Delete call record"
          >
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
};

// ==================== CallHistory Component ====================

interface CallHistoryProps {
  onSelectNumber?: (number: string) => void;
}

export const CallHistory = ({ onSelectNumber }: CallHistoryProps) => {
  const { callHistory, deleteCallRecord, deleteAllCallHistory, initiateCall } = useVoipStore();
  const [showDeleteAll, setShowDeleteAll] = useState(false);

  const handleCall = (number: string) => {
    if (onSelectNumber) {
      onSelectNumber(number);
    } else {
      initiateCall(number);
    }
  };

  const handleDeleteAll = () => {
    deleteAllCallHistory();
    setShowDeleteAll(false);
  };

  if (callHistory.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-muted">
        <PhoneIcon />
        <p className="mt-4 text-sm">No call history</p>
        <p className="text-xs mt-1">Your calls will appear here</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-primary rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-800">
        <h3 className="text-sm font-semibold text-text-primary">Call History</h3>
        
        {showDeleteAll ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleDeleteAll}
              className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Delete All
            </button>
            <button
              onClick={() => setShowDeleteAll(false)}
              className="px-3 py-1 text-xs bg-dark-600 text-text-secondary rounded hover:bg-dark-500 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteAll(true)}
            className="text-xs text-text-muted hover:text-red-500 transition-colors"
            title="Delete all call history"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Privacy Notice */}
      <div className="px-4 py-2 bg-surface-elevated border-b border-dark-800">
        <p className="text-xs text-text-muted">
          ⚠️ Call history is stored locally only. Deleted records are permanently removed and cannot be recovered.
        </p>
      </div>

      {/* Call List */}
      <div className="flex-1 overflow-y-auto">
        {callHistory.map((record) => (
          <CallHistoryItem
            key={record.id}
            record={record}
            onDelete={deleteCallRecord}
            onCall={handleCall}
          />
        ))}
      </div>
    </div>
  );
};

export default CallHistory;
