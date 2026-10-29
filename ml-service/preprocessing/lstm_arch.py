"""LSTM architecture shared by training and serving.

Direct multi-horizon: one forward pass maps the last `window` scaled residuals to the next `horizon`
scaled residuals, so serving needs a single call instead of one model.predict() per forecast day.
"""
from preprocessing.forecasting import LSTM_WINDOW, MAX_HORIZON


def build_lstm_model(window=LSTM_WINDOW, horizon=MAX_HORIZON, compile_model=False):
    from tensorflow import keras
    from tensorflow.keras import layers, regularizers

    model = keras.Sequential([
        layers.Input(shape=(window, 1)),
        layers.LSTM(48, return_sequences=False, dropout=0.1, kernel_regularizer=regularizers.l2(1e-5)),
        layers.Dense(64, activation="relu"),
        layers.Dropout(0.1),
        layers.Dense(horizon),
    ])
    if compile_model:
        model.compile(optimizer=keras.optimizers.Adam(1e-3, clipnorm=1.0), loss="huber")
    return model


def save_inference_weights(trained_model, path, window=LSTM_WINDOW, horizon=MAX_HORIZON):
    """Save weights from an UNCOMPILED clone.

    A compiled model's .weights.h5 also contains Adam optimizer state. Loading that into the (uncompiled)
    serving model is what printed "Skipping variable loading for optimizer 'adam' ..." on every start.
    """
    clone = build_lstm_model(window, horizon, compile_model=False)
    clone.set_weights(trained_model.get_weights())
    clone.save_weights(path)
