'use server'

import { saveBoardData as saveBoardDataDAL } from '@/lib/supabase/planning.server'
import type { BoardData } from '@/lib/data/planning/types'

export async function saveBoardData(data: BoardData): Promise<void> {
  return saveBoardDataDAL(data)
}
