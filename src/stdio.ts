import Queue from "p-queue"

const writeQueue = new Queue({ concurrency: 1 })

export const writeStdout = async (text: string) => {
  await writeQueue.add(
    () =>
      new Promise<void>((resolve, reject) => {
        process.stdout.write(text, (err) => {
          if (err) {
            return reject(err)
          }
          resolve()
        })
      }),
  )
}
