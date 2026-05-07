import { RoomLayout, BatchType } from '@types';

interface Props {
  layout: RoomLayout;
  onSeatClick?: (seatId: number) => void;
  onSeatHover?: (seatId: number | null) => void;
}

const batchColors: Record<BatchType, string> = {
  '11th': '#3b82f6',
  '12th': '#ef4444',
  '12th Medical': '#8b5cf6',
  '12th IIT': '#06b6d4',
  'Dropper 1': '#10b981',
  'Dropper 2': '#f59e0b',
  'Dropper 3': '#10b981',
  'Dropper 4': '#ec4899',
  'Dropper 5': '#06b6d4',
  'Dropper 6': '#14b8a6',
  'Dropper 7': '#84cc16',
  'Dropper 8': '#f97316',
  'Dropper 9': '#6366f1',
  'Dropper 10': '#a855f7',
};

export function RoomVisualization({ layout, onSeatClick, onSeatHover }: Props) {
  const { desks, dimensions } = layout;
  
  // Calculate SVG dimensions (scale: 1 foot = 20px)
  const scale = 20;
  const svgWidth = (dimensions.length_feet + 2) * scale;
  const svgHeight = (dimensions.width_feet + 2) * scale;
  const deskWidth = 3 * scale;
  const deskHeight = 2 * scale;

  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="border border-gray-300 rounded"
      >
        {/* Room outline */}
        <rect
          x={scale}
          y={scale}
          width={dimensions.length_feet * scale}
          height={dimensions.width_feet * scale}
          fill="white"
          stroke="black"
          strokeWidth={2}
        />

        {/* Desks and seats */}
        {desks.map((desk) => {
          const x = scale + desk.col * (deskWidth + 20);
          const y = scale + desk.row * (deskHeight + 20);

          return (
            <g key={`desk-${desk.desk_id}`}>
              {/* Desk background */}
              <rect
                x={x}
                y={y}
                width={deskWidth}
                height={deskHeight}
                fill="#f3f4f6"
                stroke="#9ca3af"
                strokeWidth={1}
              />

              {/* Seats */}
              {desk.seats.map((seat, idx) => {
                const seatX = x + (idx * (deskWidth / 2));
                const color = seat.batch ? batchColors[seat.batch] : '#e5e7eb';

                return (
                  <g key={`seat-${seat.seat_id}`}>
                    <rect
                      x={seatX}
                      y={y}
                      width={deskWidth / 2}
                      height={deskHeight}
                      fill={color}
                      stroke={seat.is_occupied ? '#000' : '#d1d5db'}
                      strokeWidth={2}
                      onClick={() => onSeatClick?.(seat.seat_id)}
                      onMouseEnter={() => onSeatHover?.(seat.seat_id)}
                      onMouseLeave={() => onSeatHover?.(null)}
                      className="cursor-pointer hover:opacity-80"
                    />
                    {seat.student_name && (
                      <text
                        x={seatX + deskWidth / 4}
                        y={y + deskHeight / 2}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={8}
                        fill="#000"
                        className="pointer-events-none"
                      >
                        {seat.student_roll}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Desk label */}
              <text
                x={x + deskWidth / 2}
                y={y + deskHeight + 15}
                textAnchor="middle"
                fontSize={10}
                fill="#666"
                className="pointer-events-none"
              >
                D{desk.desk_id + 1}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {Object.entries(batchColors).map(([batch, color]) => (
          <div key={batch} className="flex items-center gap-2">
            <div
              className="w-4 h-4 rounded border"
              style={{ backgroundColor: color }}
            />
            <span className="text-sm text-gray-700">{batch}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
