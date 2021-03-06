/*
 * Removes `value` from `array`, assuming it exists.
 *
 * It will only remove the first instance of `value`. It returns the index (of the original array)
 * that was removed. Therefore, callers can check for `-1` to see if nothing as removed.
 */
function removeFromArray(array, value) {
  const index = array.indexOf(value);

  if (index >= 0) {
    array.splice(index, 1);
  }

  return index;
}

/*
 * This is the generic handler adder
 * @param {string} eventName The event to handle
 * @param {string} threshold Whether to trigger the listener on `"all"` or `"any"` event
 * @param {string} frequency Whether to do this `"once"` or repeatedly (`"on"`)
 * @param {function()} listener The listener to trigger on this event
 */
function addHandler(eventName, threshold, frequency, listener) {
  if (!this.listeners[eventName]) {
    this.listeners[eventName] = [];
  }

  const handler = {
    threshold,
    frequency,
    fn: listener,
    eventArgs: new Array(this.sources.length).fill(null),
  };

  this.listeners[eventName].push(handler);
}

function clearFiredEvents(listener) {
  listener.eventArgs.fill(null);
}

function getMasterListener(eventName) {
  const aggregator = this;

  if (!this.masterListeners[eventName]) {
    this.masterListeners[eventName] = function masterListener(...eventArguments) {
      const sourceEmitter = this;
      const listeners = aggregator.listeners[eventName];

      const emitterIndex = aggregator.sources.indexOf(sourceEmitter);
      if (emitterIndex < 0) {
        throw new Error('Somehow called the listener with an emitter that we are not aggregating');
      }

      aggregator.listeners[eventName] = listeners.filter((listener) => {
        listener.eventArgs[emitterIndex] = Array.prototype.slice.call(eventArguments);

        const allFired = (listener.eventArgs.indexOf(null) < 0);
        const waitForAll = (listener.threshold === 'all');

        const callListener = allFired || !waitForAll;

        if (callListener) {
          if (waitForAll) {
            listener.fn.call(aggregator, listener.eventArgs.slice());
            clearFiredEvents(listener);
          } else {
            listener.fn.call(aggregator, sourceEmitter, eventArguments);
            clearFiredEvents(listener);
          }
        }

        return !(callListener && (listener.frequency === 'once'));
      });
    };
  }

  return this.masterListeners[eventName];
}

function attachMasterListener(eventName) {
  const masterListener = getMasterListener.call(this, eventName);
  if (!(eventName in this.listeners)) {
    this.sources.forEach(emitter => emitter.on(eventName, masterListener));
  }
}

/**
 * The EventAggregator provides a way to bring EventEmitters together into a group and to interact
 * with them as a collection (rather than individuals)
 */
class EventAggregator {
  /**
   * When instantiating an aggregator, you can pass it a single EventEmitter, a collection of
   * Emitters or nothing.
   * @param {EventEmitter[]|EventEmitter} [sources=[]]
   */
  constructor(sources = []) {
    if (!Array.isArray(sources)) {
      this.sources = [sources];
    } else {
      this.sources = sources;
    }

    this.listeners = {};
    this.masterListeners = {};
  }

  /**
   * Provides a list of the events that the aggregator is listening for.
   *
   * NB: This doesn't mean that there are necessarily any handlers attached to these events.
   * @returns {Array<string>}
   */
  eventsListenedTo() {
    return Object.keys(this.listeners);
  }

  /**
   * Add a source source to the group.
   *
   * Any listeners that are currently defined will be automatically added to this source.
   * @param {EventEmitter} source
   */
  addSource(source) {
    this.sources.push(source);
    Object.keys(this.listeners).forEach((eventName) => {
      source.on(eventName, getMasterListener.call(this, eventName));
    });
  }

  /**
   * Removers a source from the group.
   *
   * Any listeners attached to this source are also removed.
   *
   * If any listeners are attached via onAll or onceAll, then removing this source may result in
   * those listeners being fired. This will happen if the source that is being removed is the only
   * one in the group that hadn't emitted an event.
   *
   * Put another way, if *all* of the sources except this one had fired, then removing this one
   * fires the `onAll` and `onceAll` listeners.
   * @param {EventEmitter} source
   */
  removeSource(source) {
    const removedIndex = removeFromArray(this.sources, source);

    this.eventsListenedTo().forEach((eventName) => {
      source.removeListener(eventName, getMasterListener.call(this, eventName));
      this.listeners[eventName].forEach((listener) => {
        listener.eventArgs.splice(removedIndex, 1);
        const allFired = (listener.eventArgs.indexOf(null) < 0) && listener.eventArgs.length > 0;

        if (allFired) {
          listener.fn.call(this, listener.eventArgs.slice());
          clearFiredEvents(listener);
        }
      });
    });
  }

  /**
   * Removes a listener from the aggregator (just like EventEmitter#removeListener)
   *
   * @param {string} eventName The name of the event from which we're removing a listener
   * @param {function} listenerToRemove The listener that we wish to remove
   */
  removeListener(eventName, listenerToRemove) {
    const listeners = this.listeners[eventName] || [];

    this.listeners[eventName] = listeners.filter(listener => listener.fn !== listenerToRemove);
  }

  /**
   * If any of the sources in this aggregator emits a `eventName` event, trigger the associated
   * `listener`.
   *
   * Like `EventEmitter#on`, this will continue to fire until it is explicitly removed.
   *
   * The `listener` will receive a reference to the emitter that emitted the event and an array
   * of the arguments that the event included.
   *
   * @param {string} eventName
   * @param {function(EventEmitter, Array)} listener
   */
  onAny(eventName, listener) {
    attachMasterListener.call(this, eventName);
    addHandler.call(this, eventName, 'any', 'on', listener);
  }

  /**
   * Once all of the sources in this aggregator have emitted a `eventName` event, the associated
   * `listener` is triggered.
   *
   * Like `EventEmitter#on`, this will continue to fire until it is explicitly removed.
   *
   * The `listener` will receive an array of the arguments from each of the events that were emitted
   * from the aggregated sources. The array is in the order in which the sources were added to
   * this aggregator.
   *
   * If a source has emitted an event multiple times, the listener will get the arguments from the
   * first event.
   *
   * Once the listener has been triggered, this aggregator is reset for this event.
   *
   * @param {string} eventName
   * @param {function(EventEmitter, Array)} listener
   */
  onAll(eventName, listener) {
    attachMasterListener.call(this, eventName);
    addHandler.call(this, eventName, 'all', 'on', listener);
  }

  /**
   * If any of the sources in this aggregator emits a `eventName` event, trigger the associated
   * `listener`.
   *
   * Like `EventEmitter#once`, the listener will be removed once it has been triggered.
   *
   * The `listener` will receive a reference to the source that emitted the event and an array
   * of the arguments that the event included.
   *
   * @param {string} eventName
   * @param {function(EventEmitter, Array)} listener
   */
  onceAny(eventName, listener) {
    attachMasterListener.call(this, eventName);
    addHandler.call(this, eventName, 'any', 'once', listener);
  }

  /**
   * Once all of the sources in this aggregator have emitted a `eventName` event, the associated
   * `listener` is triggered.
   *
   * Like `EventEmitter#once`, the listener will be removed for this event.
   *
   * The `listener` will receive an array of the arguments from each of the events that were emitted
   * from the aggregated sources. The array is in the order in which the sources were added to
   *  aggregator.
   *
   * If a source has emitted events multiple times, the listener will get the arguments from the
   * first event.
   *
   * @param {string} eventName
   * @param {function(EventEmitter, Array)} listener
   */
  onceAll(eventName, listener) {
    attachMasterListener.call(this, eventName);
    addHandler.call(this, eventName, 'all', 'once', listener);
  }

  /**
   * If there are listeners that are waiting for all of the sources in this aggregation to emit,
   * then calling this method will reset the aggregator so that it's as if none of them have
   * emitted.
   *
   * If an `eventName` is provided, this is limited to listeners for that event. Otherwise, calling
   * this resets all of the listeners.
   *
   * @param {string} [eventName]
   */
  reset(eventName) {
    if (eventName) {
      this.listeners[eventName].forEach(clearFiredEvents);
    } else {
      Object.keys(this.listeners).forEach((name) => {
        this.reset(name);
      });
    }
  }

  /**
   * Calling this method removes all listeners from all sources. It should be called to avoid
   * memory leaks when you're done with the aggregator.
   */
  destroy() {
    this.sources.forEach(this.removeSource.bind(this));
    this.listeners = null;
  }
}

export default EventAggregator;
