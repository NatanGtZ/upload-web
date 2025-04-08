import { create } from "zustand";
import { enableMapSet } from 'immer';
import { immer } from 'zustand/middleware/immer';
import { UploadFileToStorage } from "../http/upload-file-to-storage";
import { CanceledError } from "axios";
import { useShallow } from "zustand/shallow";
import { compressImage } from "../utils/compress-image";

export interface Upload {
  name: string;
  file: File;
  abortController?: AbortController;
  status: 'progress' | 'success' | 'error' | 'canceled';
  uploadSizeInBytes : number;
  compressedSizeInBytes?: number;
  originalSizeInBytes :number;
  remoteUrl?: string;
}

type UploadsState = {
  uploads: Map<string, Upload>,
  addUploads: (files: File[]) => void,
  cancelUploads: (uploadId : string) => void,
  retryUpload: (uploadId: string) => void,
}

enableMapSet();

export const useUploads = create<UploadsState, [['zustand/immer', never]]>(
  immer((set, get) => {
    function updateUpload(uploadId: string, data: Partial<Upload>){
      const upload = get().uploads.get(uploadId)

      if(!upload) return;

      set(state => {
        state.uploads.set(uploadId, { ...upload, ...data})
      })
    }


    async function processUpload(uploadId: string) {
      const upload = get().uploads.get(uploadId)

      if(!upload) return;

      const abortController = new AbortController();

      updateUpload(uploadId, {
        uploadSizeInBytes: 0,
        remoteUrl: undefined,
        compressedSizeInBytes: undefined,
        abortController,
        status: 'progress'
      })

      try {
       const compressedFile = await compressImage({
        file: upload.file,
        maxWidth: 1000,
        maxHeight: 1000,
        quality: 0.8
      })

      updateUpload(uploadId, {
        compressedSizeInBytes: compressedFile.size
      })

        const { url }  = await UploadFileToStorage(
          {
            file: compressedFile, 
            onProgress(sizeInBytes) {
              
            updateUpload(uploadId, {
              uploadSizeInBytes: sizeInBytes
            })
            },
          },
          { signal: abortController?.signal}
        )
        
        updateUpload(uploadId, {
          status: 'success',
          remoteUrl: url,
        })
      } catch(err) {

        if(err instanceof CanceledError){
          updateUpload(uploadId, {
            status: 'canceled'
          })
          return;
        }

        updateUpload(uploadId, {
          status: 'error'
        })
      }
    }

    function cancelUploads(uploadId : string) {
      const upload = get().uploads.get(uploadId)

      if(!upload) return;

      upload.abortController?.abort();
    }

    function retryUpload(uploadId: string){
      processUpload(uploadId)
    }


    function addUploads(files: File[]) {
      for(const file of files){
        const uploadId = crypto.randomUUID();

        const upload : Upload = {
          name: file.name,
          file,  
          originalSizeInBytes: file.size,
          uploadSizeInBytes	: 0,
          status: 'progress'    
        }
      

        set(state => {
            state.uploads.set(uploadId, upload)
        })

        processUpload(uploadId)
      } 
    }
    return {
      uploads: new Map(),
      addUploads,
      cancelUploads,
      retryUpload
    }
  })
)  

export const usePendingUploads = () => {
  return useUploads(useShallow(store => {
    const isThereAnyPendingUploads = Array.
    from(store.uploads.values()).
    some(upload => upload.status === 'progress')

    if(!isThereAnyPendingUploads) {
      return {
        isThereAnyPendingUploads,
        globalPercentage: 100,
      }
    }

    const {
      total,
      uploaded
    } = Array.from(store.uploads.values()).reduce(
      (acc, upload) => {
        if(upload.compressedSizeInBytes){
          acc.uploaded += upload.uploadSizeInBytes;
        }
        acc.total += upload.compressedSizeInBytes || upload.originalSizeInBytes
        
        return acc;
      },
      { total: 0, uploaded: 0}
    )

    const globalPercentage = Math.min(
      Math.round((uploaded * 100) / total),
      100
    );
    
    return {
      isThereAnyPendingUploads,
      globalPercentage
    }

  }))
}