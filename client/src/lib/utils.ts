import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const countWords = (text: string) => text.match(/\S+/g)?.length ?? 0;
export const formatNumber = (n: number) => n.toLocaleString('fr-FR');
