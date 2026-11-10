/** OrderSystem2027 display convention. Full IDs remain the database keys. */
export const orderReference = (id: string) => id.slice(0, 8).toUpperCase();
