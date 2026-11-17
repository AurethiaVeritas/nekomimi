type IconName =
	| "play"
	| "pause"
	| "previous"
	| "next"
	| "back"
	| "forward"
	| "queue"
	| "volume"
	| "work"
	| "up"
	| "down"
	| "close"
	| "grip";

/** A single stroke family; seek controls include their interval. */
export default function PlayerIcon({ name }: { name: IconName }) {
	const paths: Partial<Record<IconName, string>> = {
		previous: "M5 5v14M19 5 7 12l12 7Z",
		next: "M19 5v14M5 5l12 7-12 7Z",
		queue: "M4 6h16M4 12h11M4 18h11M19 14v7m-3-3 3 3 3-3",
		volume: "M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
		work: "M14 3h7v7m0-7L10 14M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5",
		up: "m6 15 6-6 6 6",
		down: "m6 9 6 6 6-6",
		close: "m6 6 12 12M6 18 18 6",
	};
	return (
		<svg
			width="22"
			height="22"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{name === "play" ? (
				<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none" />
			) : null}
			{name === "pause" ? <path d="M8 5v14M16 5v14" strokeWidth="4" /> : null}
			{paths[name] ? <path d={paths[name]} /> : null}
			{name === "grip"
				? [5, 12, 19].map((y) => (
						<g key={y}>
							<circle cx="9" cy={y} r="1" fill="currentColor" />
							<circle cx="15" cy={y} r="1" fill="currentColor" />
						</g>
					))
				: null}
			{name === "back" || name === "forward" ? (
				<>
					<path
						d="M5 7a9 9 0 1 1-2 6M5 2v5H1"
						transform={
							name === "forward" ? "translate(24 0) scale(-1 1)" : undefined
						}
					/>
					<text
						x="12"
						y="15.5"
						textAnchor="middle"
						stroke="none"
						fill="currentColor"
						fontSize="9"
						fontWeight="700"
					>
						10
					</text>
				</>
			) : null}
		</svg>
	);
}
