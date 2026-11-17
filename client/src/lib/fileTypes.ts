import type { FileItem } from '../types'

const TEXT_EXTENSIONS = ['.txt', '.md', '.srt', '.vtt', '.ass', '.lrc', '.csv', '.log', '.json', '.xml', '.js', '.ts', '.jsx', '.tsx', '.css', '.html']
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov']

const hasKnownExtension = (item: FileItem, extensions: string[]) => {
  const name = (item.name || '').toLowerCase()
  return extensions.some(extension => name.endsWith(extension))
}

export const isTextLike = (item: FileItem) => {
  const mime = (item.mime || '').toLowerCase()
  return mime.startsWith('text/')
    || mime.includes('json')
    || mime.includes('xml')
    || hasKnownExtension(item, TEXT_EXTENSIONS)
}

export const isVideo = (item: FileItem) => {
  const mime = (item.mime || '').toLowerCase()
  return Boolean(item.isVideo) || mime.startsWith('video/') || hasKnownExtension(item, VIDEO_EXTENSIONS)
}

export const isPdf = (item: FileItem) => {
  const mime = (item.mime || '').toLowerCase()
  return Boolean(item.isPdf) || mime === 'application/pdf' || hasKnownExtension(item, ['.pdf'])
}
