export function toDisplayMunicipalityName(value: string): string {
	return value
		.trim()
		.replace(/\s+/g, ' ')
		.split(' ')
		.filter((part) => part.length > 0)
		.map((part) =>
			part
				.split('-')
				.map((segment) =>
					segment.length > 0
						? segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
						: segment
				)
				.join('-')
		)
		.join(' ');
}
