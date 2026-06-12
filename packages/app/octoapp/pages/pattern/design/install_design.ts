 const designMap = await getDesignMap()
    console.log("[Pattern] design list:", Array.from(designMap.entries()))
    const firstName = designMap.keys().next().value
    if (firstName) {
      const content = await readDesignFile(firstName)
      console.log("[Pattern] design content:", content)
    }
    debugger
    return;